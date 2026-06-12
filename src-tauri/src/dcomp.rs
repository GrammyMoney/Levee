//! DirectComposition video surface: libmpv renders frames (software mode) into
//! a CPU buffer, which we upload to a D3D11 texture and copy to a composition
//! swapchain. The swapchain is composited BEHIND the WebView via
//! `CreateTargetForHwnd(hwnd, topmost = FALSE)`, so the transparent WebView UI
//! floats over the video.

use crate::mpv;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Pack/unpack a window size into a single atomic word.
pub fn pack_size(w: u32, h: u32) -> u64 {
    ((w as u64) << 32) | (h as u64)
}
fn unpack_size(v: u64) -> (u32, u32) {
    ((v >> 32) as u32, (v & 0xFFFF_FFFF) as u32)
}

#[cfg(windows)]
pub fn start(hwnd: isize, width: u32, height: u32, handle: mpv::Handle, resize: Arc<AtomicU64>) {
    std::thread::spawn(move || {
        if let Err(e) = run(hwnd, width.max(16), height.max(16), handle, resize) {
            eprintln!("[dcomp] compositor failed: {e:?}");
        }
    });
}

#[cfg(not(windows))]
pub fn start(
    _hwnd: isize,
    _width: u32,
    _height: u32,
    _handle: mpv::Handle,
    _resize: Arc<AtomicU64>,
) {
}

#[cfg(windows)]
use std::sync::{Condvar, Mutex};

/// Signaled by mpv's render-update callback when a new frame is ready.
#[cfg(windows)]
struct RenderSignal {
    pending: Mutex<bool>,
    cv: Condvar,
}

#[cfg(windows)]
extern "C" fn on_mpv_update(ctx: *mut core::ffi::c_void) {
    unsafe {
        let sig = &*(ctx as *const RenderSignal);
        *sig.pending.lock().unwrap() = true;
        sig.cv.notify_one();
    }
}

#[cfg(windows)]
fn run(
    hwnd: isize,
    init_w: u32,
    init_h: u32,
    handle: mpv::Handle,
    resize: Arc<AtomicU64>,
) -> windows::core::Result<()> {
    use std::time::Duration;
    use windows::core::Interface;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::DirectComposition::*;
    use windows::Win32::Graphics::Dxgi::Common::*;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    let mut width = init_w;
    let mut height = init_h;

    // Builds a BGRA upload-texture descriptor for the given size.
    let tex_desc = |w: u32, h: u32| D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let stride_for = |w: u32| ((w as usize * 4) + 63) & !63;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        // 1. D3D11 device.
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            windows::Win32::Foundation::HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut D3D_FEATURE_LEVEL::default()),
            Some(&mut context),
        )?;
        let device = device.expect("d3d11 device");
        let context = context.expect("d3d11 context");

        // 2. DXGI factory.
        let dxgi_device: IDXGIDevice = device.cast()?;
        let adapter: IDXGIAdapter = dxgi_device.GetAdapter()?;
        let factory: IDXGIFactory2 = adapter.GetParent()?;

        // 3. Composition swapchain (BGRA, window size).
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: width,
            Height: height,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            Stereo: false.into(),
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
            AlphaMode: DXGI_ALPHA_MODE_IGNORE,
            Flags: 0,
        };
        let swapchain: IDXGISwapChain1 =
            factory.CreateSwapChainForComposition(&device, &desc, None)?;

        // 4. DirectComposition: visual behind the window's child windows (WebView).
        let comp_device: IDCompositionDevice = DCompositionCreateDevice(&dxgi_device)?;
        let target: IDCompositionTarget = comp_device.CreateTargetForHwnd(hwnd, false)?;
        let visual: IDCompositionVisual = comp_device.CreateVisual()?;
        visual.SetContent(&swapchain)?;
        target.SetRoot(&visual)?;
        comp_device.Commit()?;

        // 5. Upload texture + CPU frame buffer (bgr0, 64-byte aligned stride).
        let mut upload_tex: Option<ID3D11Texture2D> = None;
        device.CreateTexture2D(&tex_desc(width, height), None, Some(&mut upload_tex))?;
        let mut upload_tex = upload_tex.expect("upload texture");
        let mut upload_res: ID3D11Resource = upload_tex.cast()?;
        let mut stride = stride_for(width);
        let mut buf = vec![0u8; stride * height as usize];

        // 6. mpv software render context + update signal.
        let render_ctx = mpv::RenderCtx::create_sw(handle).map_err(|e| {
            eprintln!("[dcomp] {e}");
            windows::core::Error::empty()
        })?;
        let signal = Arc::new(RenderSignal {
            pending: Mutex::new(true),
            cv: Condvar::new(),
        });
        let cb_ctx = Arc::into_raw(signal.clone()) as *mut core::ffi::c_void; // leaked for process life
        render_ctx.set_update_callback(on_mpv_update, cb_ctx);

        eprintln!("[dcomp] mpv video surface live ({width}x{height})");

        // 7. Render loop: wake on mpv update (or every 100ms as a fallback).
        loop {
            {
                let mut pending = signal.pending.lock().unwrap();
                while !*pending {
                    let (g, to) = signal
                        .cv
                        .wait_timeout(pending, Duration::from_millis(100))
                        .unwrap();
                    pending = g;
                    if to.timed_out() {
                        break;
                    }
                }
                *pending = false;
            }

            // Apply a pending resize before rendering this frame.
            let (nw, nh) = unpack_size(resize.load(Ordering::Relaxed));
            if (nw, nh) != (width, height) && nw >= 16 && nh >= 16 {
                swapchain.ResizeBuffers(0, nw, nh, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG(0))?;
                let mut nt: Option<ID3D11Texture2D> = None;
                device.CreateTexture2D(&tex_desc(nw, nh), None, Some(&mut nt))?;
                upload_tex = nt.expect("upload texture");
                upload_res = upload_tex.cast()?;
                stride = stride_for(nw);
                buf = vec![0u8; stride * nh as usize];
                width = nw;
                height = nh;
                comp_device.Commit()?;
            }

            // mpv renders the current frame into our CPU buffer.
            let rc = render_ctx.render_sw(
                buf.as_mut_ptr() as *mut core::ffi::c_void,
                width as i32,
                height as i32,
                stride,
            );
            if rc < 0 {
                continue;
            }

            // Upload → backbuffer → present.
            context.UpdateSubresource(
                &upload_res,
                0,
                None,
                buf.as_ptr() as *const core::ffi::c_void,
                stride as u32,
                0,
            );
            let backbuffer: ID3D11Texture2D = swapchain.GetBuffer(0)?;
            let back_res: ID3D11Resource = backbuffer.cast()?;
            context.CopyResource(&back_res, &upload_res);
            swapchain.Present(1, DXGI_PRESENT(0)).ok()?;
        }
    }
}
