use serde::Serialize;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mxf", "mkv", "avi", "webm", "mp3", "wav", "aiff", "aac", "flac", "ogg", "jpg",
    "jpeg", "png", "tiff", "tif", "webp",
];

// ── File utilities ────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn pick_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn get_sibling_files(path: String) -> Vec<String> {
    let p = Path::new(&path);
    let dir = match p.parent() {
        Some(d) => d,
        None => return vec![],
    };
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name();
            let ext = Path::new(&name).extension()?.to_str()?.to_lowercase();
            if MEDIA_EXTENSIONS.contains(&ext.as_str()) {
                Some(e.path().to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect();
    files.sort();
    files
}

#[tauri::command]
pub(crate) fn get_file_size(path: String) -> u64 {
    std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
pub(crate) fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(path);
    app.opener()
        .open_path(dir, None::<&str>)
        .map_err(|e| e.to_string())
}
/// Opens the Windows "Default apps" settings so the user can make Levee the
/// default handler for video files. Win10/11 require the user to confirm the
/// choice there — an app can't silently set itself as default.
#[tauri::command]
pub(crate) fn set_as_default_player() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::{w, HSTRING};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let uri = HSTRING::from("ms-settings:defaultapps");
        let r = unsafe { ShellExecuteW(None, w!("open"), &uri, None, None, SW_SHOWNORMAL) };
        // ShellExecuteW returns an HINSTANCE; a value <= 32 means failure.
        if (r.0 as isize) <= 32 {
            return Err("failed to open Default apps settings".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("only available on Windows".into())
    }
}

/// Opens a URL in the user's default browser.
#[tauri::command]
pub(crate) fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::{w, HSTRING};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let u = HSTRING::from(url);
        let r = unsafe { ShellExecuteW(None, w!("open"), &u, None, None, SW_SHOWNORMAL) };
        if (r.0 as isize) <= 32 {
            return Err("failed to open URL".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("only available on Windows".into())
    }
}
// ── Directory listing ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirListing {
    pub path: String,
    pub parent_path: Option<String>,
    pub subdirs: Vec<String>,
    pub media_files: Vec<String>,
}

#[tauri::command]
pub(crate) fn list_directory(path: String) -> Result<DirListing, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let parent_path = dir.parent().map(|p| p.to_string_lossy().into_owned());

    let mut subdirs: Vec<String> = vec![];
    let mut media_files: Vec<String> = vec![];

    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let full = entry.path().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push(full);
        } else if ft.is_file() {
            let ext = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            if MEDIA_EXTENSIONS.contains(&ext.as_str()) {
                media_files.push(full);
            }
        }
    }

    subdirs.sort();
    media_files.sort();

    Ok(DirListing {
        path,
        parent_path,
        subdirs,
        media_files,
    })
}
/// Returns all mounted drive roots (Windows: A:\–Z:\; macOS: /Volumes/*).
#[tauri::command]
pub(crate) fn list_drives() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        ('A'..='Z')
            .filter_map(|c| {
                let path = format!("{}:\\", c);
                if std::path::Path::new(&path).exists() {
                    Some(path)
                } else {
                    None
                }
            })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut drives = vec!["/".to_string()];
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                drives.push(entry.path().to_string_lossy().into_owned());
            }
        }
        drives
    }
}
