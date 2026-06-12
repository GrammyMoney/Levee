use crate::process_tools::{quiet_command, resolve_ffmpeg};
use crate::proxy_paths::thumbnail_path_for;
use crate::AppState;
use std::path::Path;

/// Extracts a single thumbnail frame from a video file using ffmpeg.
/// Stored at `{drive_root}\Levee\Thumbnails\{xx}\{yy}\{hash16}.jpg`.
/// Returns immediately if the file already exists (no ffmpeg needed).
#[tauri::command]
pub(crate) async fn get_thumbnail(
    state: tauri::State<'_, AppState>,
    original_path: String,
) -> Result<String, String> {
    let path = Path::new(&original_path);
    let thumb = thumbnail_path_for(path)?;
    let thumb_str = thumb.to_string_lossy().into_owned();

    // Fast path: already generated
    if thumb.exists() {
        return Ok(thumb_str);
    }

    // Create bucket dirs
    if let Some(dir) = thumb.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let orig = original_path.clone();
    let dest = thumb_str.clone();
    let ffmpeg = resolve_ffmpeg();

    let out = tauri::async_runtime::spawn_blocking(move || {
        quiet_command(&ffmpeg)
            .args([
                "-ss",
                "00:00:03",
                "-i",
                &orig,
                "-vframes",
                "1",
                "-vf",
                "scale=320:-2",
                "-q:v",
                "5",
                "-y",
                &dest,
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !out.status.success() || !thumb.exists() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .lines()
            .last()
            .unwrap_or("ffmpeg failed")
            .to_string());
    }

    // Write to DB for shared discovery on Suite drives
    state.record_thumbnail(&original_path, &thumb_str);

    Ok(thumb_str)
}
