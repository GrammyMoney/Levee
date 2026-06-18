use crate::process_tools::{quiet_command, resolve_ffmpeg};
use crate::proxy_paths::{proxies_root_for, proxy_path_for};
use crate::AppState;
use std::collections::HashMap;
use std::path::Path;

// ── Proxy path helpers ────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_proxy(original_path: String) -> Option<String> {
    let path = proxy_path_for(Path::new(&original_path)).ok()?;
    if path.exists() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Batch proxy lookup — returns map of original_path → proxy_path for files
/// whose proxy file exists on disk.  DB-free: just checks computed paths.
#[tauri::command]
pub(crate) fn get_proxies_batch(file_paths: Vec<String>) -> HashMap<String, String> {
    file_paths
        .into_iter()
        .filter_map(|orig| {
            let proxy = proxy_path_for(Path::new(&orig)).ok()?;
            if proxy.exists() {
                Some((orig, proxy.to_string_lossy().into_owned()))
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn generate_proxy(
    state: tauri::State<'_, AppState>,
    original_path: String,
) -> Result<String, String> {
    let proxy_pb = proxy_path_for(Path::new(&original_path))?;
    let proxy_str = proxy_pb.to_string_lossy().into_owned();

    // Return immediately if proxy already exists
    if proxy_pb.exists() {
        return Ok(proxy_str);
    }

    // Ensure bucket directory exists
    if let Some(dir) = proxy_pb.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let orig = original_path.clone();
    let proxy = proxy_str.clone();
    let ffmpeg = resolve_ffmpeg();

    let out = tauri::async_runtime::spawn_blocking(move || {
        quiet_command(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                &orig,
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                // Normalize color metadata before the pixel-format conversion —
                // camera ProRes (incl. 4444 / 12-bit 4:4:4) carries reserved/gbr
                // color tags that swscale otherwise refuses to convert to yuv420p.
                "-vf",
                "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale=trunc(iw/4)*2:trunc(ih/4)*2,format=yuv420p",
                "-c:v",
                "libx264",
                "-crf",
                "23",
                "-preset",
                "fast",
                "-movflags",
                "+faststart",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ac",
                "2",
                "-y",
                &proxy,
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        eprintln!("[proxy] ffmpeg failed for {original_path}:\n{stderr}");
        return Err(format!(
            "ffmpeg error: {}",
            stderr.lines().last().unwrap_or("unknown")
        ));
    }

    // Write to DB for auditing / shared discovery on Suite drives
    state.record_proxy(&original_path, &proxy_str);

    Ok(proxy_str)
}

/// Deletes the proxy file and removes its DB record.
#[tauri::command]
pub(crate) fn delete_proxy(
    state: tauri::State<AppState>,
    original_path: String,
) -> Result<(), String> {
    let proxy_pb = proxy_path_for(Path::new(&original_path))?;
    let _ = std::fs::remove_file(&proxy_pb);
    state.delete_proxy_record(&original_path)
}

#[tauri::command]
pub(crate) fn get_proxies_root(original_path: String) -> Result<String, String> {
    proxies_root_for(Path::new(&original_path)).map(|p| p.to_string_lossy().into_owned())
}
