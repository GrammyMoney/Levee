//! Runtime FFI bindings to libmpv (loaded from `binaries/libmpv-2.dll`) plus a
//! thin safe wrapper. Only the subset of the client + render API we use is
//! declared. ABI constants/struct layouts taken from the vendored headers in
//! `vendor/mpv/include/mpv/`.

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::OnceLock;

// ── Opaque handles ──────────────────────────────────────────────────────────
#[repr(C)]
pub struct mpv_handle {
    _private: [u8; 0],
}
#[repr(C)]
pub struct mpv_render_context {
    _private: [u8; 0],
}

// ── Constants (from client.h / render.h) ────────────────────────────────────
pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

pub const MPV_RENDER_PARAM_INVALID: c_int = 0;
pub const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
pub const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
pub const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
pub const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
pub const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;

// ── Structs ─────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct mpv_render_param {
    pub type_: c_int,
    pub data: *mut c_void,
}
#[repr(C)]
pub struct mpv_event {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}
#[repr(C)]
pub struct mpv_event_property {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

pub type mpv_render_update_fn = extern "C" fn(*mut c_void);

// ── Function pointer types ──────────────────────────────────────────────────
type FnCreate = unsafe extern "C" fn() -> *mut mpv_handle;
type FnInitialize = unsafe extern "C" fn(*mut mpv_handle) -> c_int;
type FnSetOptionString =
    unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int;
type FnCommand = unsafe extern "C" fn(*mut mpv_handle, *const *const c_char) -> c_int;
type FnSetProperty =
    unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int;
type FnObserveProperty = unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, c_int) -> c_int;
type FnWaitEvent = unsafe extern "C" fn(*mut mpv_handle, f64) -> *mut mpv_event;
type FnErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
type FnRenderCreate = unsafe extern "C" fn(
    *mut *mut mpv_render_context,
    *mut mpv_handle,
    *mut mpv_render_param,
) -> c_int;
type FnRenderSetUpdateCb =
    unsafe extern "C" fn(*mut mpv_render_context, mpv_render_update_fn, *mut c_void);
type FnRenderRender = unsafe extern "C" fn(*mut mpv_render_context, *mut mpv_render_param) -> c_int;
type FnRenderFree = unsafe extern "C" fn(*mut mpv_render_context);

#[allow(dead_code)]
pub struct MpvLib {
    _lib: libloading::Library, // kept alive for the process lifetime
    create: FnCreate,
    initialize: FnInitialize,
    set_option_string: FnSetOptionString,
    command: FnCommand,
    set_property: FnSetProperty,
    observe_property: FnObserveProperty,
    wait_event: FnWaitEvent,
    error_string: FnErrorString,
    render_create: FnRenderCreate,
    render_set_update_cb: FnRenderSetUpdateCb,
    render_render: FnRenderRender,
    render_free: FnRenderFree,
}

// Library + raw fn pointers are safe to share across threads (libmpv's client
// API is explicitly thread-safe).
unsafe impl Send for MpvLib {}
unsafe impl Sync for MpvLib {}

static MPV: OnceLock<MpvLib> = OnceLock::new();

fn lib() -> &'static MpvLib {
    MPV.get().expect("libmpv not loaded")
}

/// Locate libmpv-2.dll across dev and bundled layouts.
fn find_libmpv() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("libmpv-2.dll"));
            candidates.push(dir.join("binaries").join("libmpv-2.dll"));
            // bundled installer layout (Tauri resource dir)
            candidates.push(dir.join("resources").join("binaries").join("libmpv-2.dll"));
            // dev: target/debug/levee.exe -> ../../binaries
            candidates.push(
                dir.join("..")
                    .join("..")
                    .join("binaries")
                    .join("libmpv-2.dll"),
            );
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("libmpv-2.dll"),
    );
    candidates.into_iter().find(|p| p.exists())
}

/// Load libmpv-2.dll and resolve all symbols. Call once at startup.
pub fn load() -> Result<(), String> {
    if MPV.get().is_some() {
        return Ok(());
    }
    let path = find_libmpv()
        .ok_or_else(|| "libmpv-2.dll not found — expected in src-tauri/binaries/".to_string())?;

    // Make sure dependent DLLs next to libmpv resolve.
    #[cfg(windows)]
    if let Some(parent) = path.parent() {
        use windows::core::HSTRING;
        use windows::Win32::System::LibraryLoader::SetDllDirectoryW;
        unsafe {
            let _ = SetDllDirectoryW(&HSTRING::from(parent));
        }
    }

    unsafe {
        let library = libloading::Library::new(&path)
            .map_err(|e| format!("failed to load {}: {e}", path.display()))?;

        macro_rules! sym {
            ($name:expr) => {
                *library.get($name).map_err(|e| {
                    format!("missing symbol {}: {e}", String::from_utf8_lossy($name))
                })?
            };
        }

        let mpvlib = MpvLib {
            create: sym!(b"mpv_create\0"),
            initialize: sym!(b"mpv_initialize\0"),
            set_option_string: sym!(b"mpv_set_option_string\0"),
            command: sym!(b"mpv_command\0"),
            set_property: sym!(b"mpv_set_property\0"),
            observe_property: sym!(b"mpv_observe_property\0"),
            wait_event: sym!(b"mpv_wait_event\0"),
            error_string: sym!(b"mpv_error_string\0"),
            render_create: sym!(b"mpv_render_context_create\0"),
            render_set_update_cb: sym!(b"mpv_render_context_set_update_callback\0"),
            render_render: sym!(b"mpv_render_context_render\0"),
            render_free: sym!(b"mpv_render_context_free\0"),
            _lib: library,
        };
        let _ = MPV.set(mpvlib);
    }
    Ok(())
}

fn err_str(code: c_int) -> String {
    if code >= 0 {
        return "ok".into();
    }
    unsafe {
        let p = (lib().error_string)(code);
        if p.is_null() {
            format!("mpv error {code}")
        } else {
            CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    }
}

// ── Handle wrapper (thread-safe per libmpv client API contract) ─────────────
#[derive(Clone, Copy)]
pub struct Handle(pub *mut mpv_handle);
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}

impl Handle {
    /// Create + configure + initialize a libmpv instance for render-API output.
    pub fn create() -> Result<Handle, String> {
        unsafe {
            let h = (lib().create)();
            if h.is_null() {
                return Err("mpv_create returned null".into());
            }
            let handle = Handle(h);
            // Options that must be set before initialize.
            handle.set_option("vo", "libmpv")?; // required for the render API
            handle.set_option("idle", "yes")?; // stay alive with no file loaded
            handle.set_option("keep-open", "yes")?; // pause at EOF instead of unloading
            handle.set_option("force-window", "no")?;
            handle.set_option("osc", "no")?;
            handle.set_option("input-default-bindings", "no")?;
            handle.set_option("input-vo-keyboard", "no")?;
            handle.set_option("terminal", "no")?;
            // Reasonable defaults for a review player.
            handle.set_option("hwdec", "no")?; // SW render path; keep decode simple for now
            handle.set_option("audio-channels", "stereo")?;

            let rc = (lib().initialize)(h);
            if rc < 0 {
                return Err(format!("mpv_initialize failed: {}", err_str(rc)));
            }
            Ok(handle)
        }
    }

    fn set_option(&self, name: &str, val: &str) -> Result<(), String> {
        let n = CString::new(name).unwrap();
        let v = CString::new(val).unwrap();
        let rc = unsafe { (lib().set_option_string)(self.0, n.as_ptr(), v.as_ptr()) };
        if rc < 0 {
            Err(format!("set_option {name}={val}: {}", err_str(rc)))
        } else {
            Ok(())
        }
    }

    /// Run an mpv command given as a list of string arguments.
    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let cstrings: Vec<CString> = args.iter().map(|a| CString::new(*a).unwrap()).collect();
        let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (lib().command)(self.0, ptrs.as_ptr()) };
        if rc < 0 {
            Err(format!("command {args:?}: {}", err_str(rc)))
        } else {
            Ok(())
        }
    }

    pub fn set_flag(&self, name: &str, val: bool) -> Result<(), String> {
        let n = CString::new(name).unwrap();
        let mut v: c_int = if val { 1 } else { 0 };
        let rc = unsafe {
            (lib().set_property)(
                self.0,
                n.as_ptr(),
                MPV_FORMAT_FLAG,
                &mut v as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(err_str(rc))
        } else {
            Ok(())
        }
    }

    pub fn set_double(&self, name: &str, val: f64) -> Result<(), String> {
        let n = CString::new(name).unwrap();
        let mut v = val;
        let rc = unsafe {
            (lib().set_property)(
                self.0,
                n.as_ptr(),
                MPV_FORMAT_DOUBLE,
                &mut v as *mut _ as *mut c_void,
            )
        };
        if rc < 0 {
            Err(err_str(rc))
        } else {
            Ok(())
        }
    }

    pub fn set_string(&self, name: &str, val: &str) -> Result<(), String> {
        let n = CString::new(name).unwrap();
        let mut v = CString::new(val).unwrap();
        let ptr = v.as_ptr();
        // MPV_FORMAT_STRING expects a char** (pointer to the string pointer)
        let mut sp = ptr;
        let rc = unsafe {
            (lib().set_property)(
                self.0,
                n.as_ptr(),
                MPV_FORMAT_STRING,
                &mut sp as *mut _ as *mut c_void,
            )
        };
        let _ = &mut v;
        if rc < 0 {
            Err(err_str(rc))
        } else {
            Ok(())
        }
    }

    pub fn observe_double(&self, id: u64, name: &str) {
        let n = CString::new(name).unwrap();
        unsafe {
            (lib().observe_property)(self.0, id, n.as_ptr(), MPV_FORMAT_DOUBLE);
        }
    }
    pub fn observe_flag(&self, id: u64, name: &str) {
        let n = CString::new(name).unwrap();
        unsafe {
            (lib().observe_property)(self.0, id, n.as_ptr(), MPV_FORMAT_FLAG);
        }
    }

    /// Blocking event wait. Returns a reference valid until the next wait call.
    pub unsafe fn wait_event(&self, timeout: f64) -> *mut mpv_event {
        (lib().wait_event)(self.0, timeout)
    }
}

// ── Render context wrapper ──────────────────────────────────────────────────
pub struct RenderCtx(*mut mpv_render_context);
unsafe impl Send for RenderCtx {}

impl RenderCtx {
    /// Create a software-rendering context bound to the given mpv handle.
    pub fn create_sw(handle: Handle) -> Result<RenderCtx, String> {
        let api = CString::new("sw").unwrap();
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: api.as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        let mut ctx: *mut mpv_render_context = std::ptr::null_mut();
        let rc = unsafe { (lib().render_create)(&mut ctx, handle.0, params.as_mut_ptr()) };
        if rc < 0 {
            return Err(format!("render_context_create: {}", err_str(rc)));
        }
        Ok(RenderCtx(ctx))
    }

    pub fn set_update_callback(&self, cb: mpv_render_update_fn, ctx: *mut c_void) {
        unsafe { (lib().render_set_update_cb)(self.0, cb, ctx) }
    }

    /// Render the current frame into a CPU buffer (bgr0, `stride` bytes/row).
    pub fn render_sw(&self, buf: *mut c_void, w: i32, h: i32, stride: usize) -> i32 {
        let mut size = [w, h];
        let fmt = CString::new("bgr0").unwrap();
        let mut stride_v = stride;
        let mut params = [
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_SIZE,
                data: size.as_mut_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_FORMAT,
                data: fmt.as_ptr() as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_STRIDE,
                data: &mut stride_v as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_SW_POINTER,
                data: buf,
            },
            mpv_render_param {
                type_: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];
        unsafe { (lib().render_render)(self.0, params.as_mut_ptr()) }
    }
}

impl Drop for RenderCtx {
    fn drop(&mut self) {
        unsafe { (lib().render_free)(self.0) }
    }
}
