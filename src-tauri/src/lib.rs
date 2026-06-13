mod cache;
mod dcomp;
mod mpv;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mxf", "mkv", "avi", "webm",
    "mp3", "wav", "aiff", "aac", "flac", "ogg",
    "jpg", "jpeg", "png", "tiff", "tif", "webp",
];

// Schema for levee.db — lives at {drive_root}\Levee\levee.db on Suite drives,
// or the app-local fallback DB for non-Suite drives.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS proxies (
    original_path TEXT PRIMARY KEY,
    proxy_path    TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS thumbnails (
    original_path   TEXT PRIMARY KEY,
    thumbnail_path  TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
";

// ── App state ─────────────────────────────────────────────────────────────────

struct DbPool {
    local: Connection,
    /// Shared levee.db connections per managed drive, keyed by drive root e.g. "S:\\"
    managed: HashMap<String, Connection>,
    /// Drive root (normalized) → provider (Local / Suite / LucidLink)
    drive_providers: HashMap<String, cache::Provider>,
}

impl DbPool {
    /// The configured provider for the drive containing `path`.
    fn provider_for(&self, path: &Path) -> cache::Provider {
        drive_root_of(path)
            .and_then(|root| self.drive_providers.get(&norm_path(&root)).copied())
            .unwrap_or(cache::Provider::Local)
    }

    /// Returns the DB appropriate for `path`. Any non-local (managed) drive gets a
    /// shared `{drive}\Levee\levee.db`; everything else uses the app-local DB.
    fn db_for(&mut self, path: &Path) -> &mut Connection {
        if let Some(root) = drive_root_of(path) {
            let norm = norm_path(&root);
            let managed = self.drive_providers.get(&norm).map(|p| p.is_managed()).unwrap_or(false);
            if managed {
                if !self.managed.contains_key(&root) {
                    let db_path = Path::new(&root).join("Levee").join("levee.db");
                    if let Some(dir) = db_path.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    if let Ok(conn) = Connection::open(&db_path) {
                        let _ = conn.execute_batch(SCHEMA);
                        self.managed.insert(root.clone(), conn);
                    }
                }
                if self.managed.contains_key(&root) {
                    return self.managed.get_mut(&root).unwrap();
                }
            }
        }
        &mut self.local
    }
}

struct AppState(Mutex<DbPool>);

/// Holds the live libmpv handle for control commands.
struct MpvState {
    handle: mpv::Handle,
}

/// A file the app was launched with (file association / CLI), pulled by the
/// frontend once it mounts. Avoids a race with the fire-and-forget open event.
struct PendingOpen(Mutex<Option<String>>);

fn norm_path(p: &str) -> String {
    p.to_lowercase().replace('/', "\\").trim_end_matches('\\').to_string() + "\\"
}

/// Returns the Windows drive root (e.g. "C:\\") for a path, or None on non-Windows paths.
fn drive_root_of(path: &Path) -> Option<String> {
    use std::path::Component;
    match path.components().next() {
        Some(Component::Prefix(p)) => {
            Some(format!("{}\\", p.as_os_str().to_string_lossy()))
        }
        _ => None,
    }
}

// ── File utilities ────────────────────────────────────────────────────────────

#[tauri::command]
fn pick_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_sibling_files(path: String) -> Vec<String> {
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
fn get_file_size(path: String) -> u64 {
    std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(path);
    app.opener().open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

/// Returns (and clears) the file the app was launched with, if any.
/// Called by the frontend on mount to open files from associations/CLI.
#[tauri::command]
fn take_launch_file(pending: tauri::State<PendingOpen>) -> Option<String> {
    pending.0.lock().unwrap().take()
}

/// Opens the Windows "Default apps" settings so the user can make Levee the
/// default handler for video files. Win10/11 require the user to confirm the
/// choice there — an app can't silently set itself as default.
#[tauri::command]
fn set_as_default_player() -> Result<(), String> {
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
fn open_url(url: String) -> Result<(), String> {
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

// ── ffprobe metadata ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProbeData {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: String,
    pub bit_rate: String,
    pub duration_secs: f64,
    pub timecode: String,
    pub container: String,
    pub audio_codec: String,
    pub audio_channels: u32,
    pub file_size: String,
    pub color_space: String,
}

/// Build a process Command that does NOT flash a console window on Windows.
/// (CREATE_NO_WINDOW = 0x08000000.) Used for every external tool we spawn.
fn quiet_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    let cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x0800_0000);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

/// Resolve the `ffmpeg` executable. Prefers the bundled sidecar shipped next to
/// the app exe, then common install locations (winget's shim dir), then PATH.
fn resolve_ffmpeg() -> String {
    // Bundled sidecar (externalBin): lands next to the exe as `ffmpeg.exe`.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if sidecar.exists() {
                return sidecar.to_string_lossy().into_owned();
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let shim = Path::new(&local)
                .join("Microsoft").join("WinGet").join("Links").join("ffmpeg.exe");
            if shim.exists() { return shim.to_string_lossy().into_owned(); }
        }
        for c in [
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        ] {
            if Path::new(c).exists() { return c.to_string(); }
        }
    }
    "ffmpeg".to_string()
}

/// Locate the bundled ffprobe sidecar. In dev mode falls back to PATH.
fn ffprobe_binary(app: &tauri::AppHandle) -> PathBuf {
    // In a Tauri bundle, sidecars land next to the main executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Also check resource_dir (dev builds)
    if let Ok(res) = app.path().resource_dir() {
        let candidate = res.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" })
}

fn format_bitrate(bps: u64) -> String {
    if bps >= 1_000_000 {
        format!("{:.1} Mbps", bps as f64 / 1_000_000.0)
    } else if bps >= 1_000 {
        format!("{:.0} Kbps", bps as f64 / 1_000.0)
    } else {
        format!("{bps} bps")
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1_024 {
        format!("{:.1} KB", bytes as f64 / 1_024.0)
    } else {
        format!("{bytes} B")
    }
}

fn parse_frame_rate(s: &str) -> String {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        if let (Ok(num), Ok(den)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
            if den > 0.0 {
                let fps = num / den;
                // Common fractional frame rates
                let rounded = (fps * 1000.0).round() / 1000.0;
                return format!("{rounded:.3}").trim_end_matches('0').trim_end_matches('.').to_string() + " fps";
            }
        }
    }
    s.to_string()
}

fn pretty_codec(raw: &str) -> String {
    match raw.to_lowercase().as_str() {
        "h264" | "libx264"  => "H.264".to_string(),
        "h265" | "hevc" | "libx265" => "H.265 (HEVC)".to_string(),
        "prores"            => "Apple ProRes".to_string(),
        "dnxhd"             => "Avid DNxHD".to_string(),
        "vp9"               => "VP9".to_string(),
        "av1"               => "AV1".to_string(),
        "mpeg2video"        => "MPEG-2".to_string(),
        "mjpeg"             => "MJPEG".to_string(),
        "aac"               => "AAC".to_string(),
        "mp3"               => "MP3".to_string(),
        "pcm_s16le" | "pcm_s24le" | "pcm_s32le" => "PCM".to_string(),
        other               => other.to_uppercase(),
    }
}

fn pretty_container(fmt_name: &str) -> String {
    let first = fmt_name.split(',').next().unwrap_or(fmt_name);
    match first {
        "mov"        => "MOV".to_string(),
        "mp4"        => "MP4".to_string(),
        "matroska"   => "MKV".to_string(),
        "avi"        => "AVI".to_string(),
        "mxf"        => "MXF".to_string(),
        "webm"       => "WebM".to_string(),
        other        => other.to_uppercase(),
    }
}

#[tauri::command]
fn get_probe_data(app: tauri::AppHandle, path: String) -> Result<ProbeData, String> {
    let ffprobe = ffprobe_binary(&app);
    let output = quiet_command(&ffprobe)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe error: {stderr}"));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {e}"))?;

    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let format = &json["format"];

    // Find first video stream
    let video = streams.iter().find(|s| s["codec_type"].as_str() == Some("video"));
    // Find first audio stream
    let audio = streams.iter().find(|s| s["codec_type"].as_str() == Some("audio"));

    let codec = video
        .and_then(|v| v["codec_name"].as_str())
        .map(pretty_codec)
        .unwrap_or_else(|| "—".to_string());

    let width  = video.and_then(|v| v["width"].as_u64()).unwrap_or(0)  as u32;
    let height = video.and_then(|v| v["height"].as_u64()).unwrap_or(0) as u32;

    let frame_rate = video
        .and_then(|v| v["r_frame_rate"].as_str())
        .map(parse_frame_rate)
        .unwrap_or_else(|| "—".to_string());

    // Prefer stream bit_rate, fall back to format bit_rate
    let bps = video
        .and_then(|v| v["bit_rate"].as_str().and_then(|s| s.parse::<u64>().ok()))
        .or_else(|| format["bit_rate"].as_str().and_then(|s| s.parse::<u64>().ok()))
        .unwrap_or(0);
    let bit_rate = if bps > 0 { format_bitrate(bps) } else { "—".to_string() };

    let duration_secs = format["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Timecode: check stream tags → format tags → derive from duration
    let timecode = video
        .and_then(|v| v["tags"]["timecode"].as_str())
        .or_else(|| format["tags"]["timecode"].as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let h = (duration_secs / 3600.0) as u32;
            let m = ((duration_secs % 3600.0) / 60.0) as u32;
            let s = (duration_secs % 60.0) as u32;
            format!("{h:02}:{m:02}:{s:02}:00")
        });

    let container = format["format_name"]
        .as_str()
        .map(pretty_container)
        .unwrap_or_else(|| "—".to_string());

    let audio_codec = audio
        .and_then(|a| a["codec_name"].as_str())
        .map(pretty_codec)
        .unwrap_or_else(|| "—".to_string());

    let audio_channels = audio
        .and_then(|a| a["channels"].as_u64())
        .unwrap_or(0) as u32;

    let file_size = std::fs::metadata(&path)
        .map(|m| format_bytes(m.len()))
        .unwrap_or_else(|_| "—".to_string());

    let color_space = video
        .and_then(|v| v["color_space"].as_str())
        .unwrap_or("—")
        .to_string();

    Ok(ProbeData {
        codec,
        width,
        height,
        frame_rate,
        bit_rate,
        duration_secs,
        timecode,
        container,
        audio_codec,
        audio_channels,
        file_size,
        color_space,
    })
}

// ── Proxy path helpers ────────────────────────────────────────────────────────

/// FNV-1a 64-bit hash — deterministic across runs and machines.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 14695981039346656037;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

/// Normalize a path for hashing: lowercase, backslashes → forward slashes.
fn norm_for_hash(path: &Path) -> String {
    path.to_string_lossy().to_lowercase().replace('\\', "/")
}

/// Returns `{drive_root}\Levee\Proxies` for the drive containing `original`.
fn proxies_root_for(original: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    match original.components().next() {
        Some(Component::Prefix(p)) => {
            let root = PathBuf::from(format!("{}\\", p.as_os_str().to_string_lossy()));
            Ok(root.join("Levee").join("Proxies"))
        }
        _ => Err(format!("Cannot determine drive root for: {}", original.display())),
    }
}

/// Returns `{drive_root}\Levee\Thumbnails` for the drive containing `original`.
fn thumbnails_root_for(original: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    match original.components().next() {
        Some(Component::Prefix(p)) => {
            let root = PathBuf::from(format!("{}\\", p.as_os_str().to_string_lossy()));
            Ok(root.join("Levee").join("Thumbnails"))
        }
        _ => Err(format!("Cannot determine drive root for: {}", original.display())),
    }
}

/// Deterministic hashed path for a proxy.
/// `{drive_root}\Levee\Proxies\{xx}\{yy}\{hash16}.mp4`
fn proxy_path_for(original: &Path) -> Result<PathBuf, String> {
    let root = proxies_root_for(original)?;
    let hash = format!("{:016x}", fnv1a(&norm_for_hash(original)));
    Ok(root.join(&hash[0..2]).join(&hash[2..4]).join(format!("{hash}.mp4")))
}

/// Deterministic hashed path for a thumbnail.
/// `{drive_root}\Levee\Thumbnails\{xx}\{yy}\{hash16}.jpg`
fn thumbnail_path_for(original: &Path) -> Result<PathBuf, String> {
    let root = thumbnails_root_for(original)?;
    let hash = format!("{:016x}", fnv1a(&norm_for_hash(original)));
    Ok(root.join(&hash[0..2]).join(&hash[2..4]).join(format!("{hash}.jpg")))
}

// ── Proxy commands ────────────────────────────────────────────────────────────

/// Returns the proxy path if the proxy file exists on disk.
/// Path is fully deterministic — no DB query needed.
#[tauri::command]
fn get_proxy(original_path: String) -> Option<String> {
    let path = proxy_path_for(Path::new(&original_path)).ok()?;
    if path.exists() { Some(path.to_string_lossy().into_owned()) } else { None }
}

/// Batch proxy lookup — returns map of original_path → proxy_path for files
/// whose proxy file exists on disk.  DB-free: just checks computed paths.
#[tauri::command]
fn get_proxies_batch(file_paths: Vec<String>) -> HashMap<String, String> {
    file_paths.into_iter().filter_map(|orig| {
        let proxy = proxy_path_for(Path::new(&orig)).ok()?;
        if proxy.exists() { Some((orig, proxy.to_string_lossy().into_owned())) } else { None }
    }).collect()
}

#[tauri::command]
async fn generate_proxy(
    state: tauri::State<'_, AppState>,
    original_path: String,
) -> Result<String, String> {
    let proxy_pb  = proxy_path_for(Path::new(&original_path))?;
    let proxy_str = proxy_pb.to_string_lossy().into_owned();

    // Return immediately if proxy already exists
    if proxy_pb.exists() { return Ok(proxy_str); }

    // Ensure bucket directory exists
    if let Some(dir) = proxy_pb.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let orig  = original_path.clone();
    let proxy = proxy_str.clone();
    let ffmpeg = resolve_ffmpeg();

    let out = tauri::async_runtime::spawn_blocking(move || {
        quiet_command(&ffmpeg)
            .args([
                "-hide_banner", "-loglevel", "error",
                "-i",        &orig,
                "-map",      "0:v:0",
                "-map",      "0:a:0?",
                // Normalize color metadata before the pixel-format conversion —
                // camera ProRes (incl. 4444 / 12-bit 4:4:4) carries reserved/gbr
                // color tags that swscale otherwise refuses to convert to yuv420p.
                "-vf",       "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,scale=trunc(iw/4)*2:trunc(ih/4)*2,format=yuv420p",
                "-c:v",      "libx264",
                "-crf",      "23",
                "-preset",   "fast",
                "-movflags", "+faststart",
                "-c:a",      "aac",
                "-b:a",      "128k",
                "-ac",       "2",
                "-y",        &proxy,
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        eprintln!("[proxy] ffmpeg failed for {original_path}:\n{stderr}");
        return Err(format!("ffmpeg error: {}", stderr.lines().last().unwrap_or("unknown")));
    }

    // Write to DB for auditing / shared discovery on Suite drives
    {
        let mut pool = state.0.lock().unwrap();
        let db = pool.db_for(Path::new(&original_path));
        let _ = db.execute(
            "INSERT INTO proxies (original_path, proxy_path)
             VALUES (?1, ?2)
             ON CONFLICT(original_path) DO UPDATE SET
               proxy_path = excluded.proxy_path,
               created_at = strftime('%s','now')",
            params![original_path, proxy_str],
        );
    }

    Ok(proxy_str)
}

/// Deletes the proxy file and removes its DB record.
#[tauri::command]
fn delete_proxy(state: tauri::State<AppState>, original_path: String) -> Result<(), String> {
    let proxy_pb = proxy_path_for(Path::new(&original_path))?;
    let _ = std::fs::remove_file(&proxy_pb);
    let mut pool = state.0.lock().unwrap();
    let db = pool.db_for(Path::new(&original_path));
    db.execute("DELETE FROM proxies WHERE original_path = ?1", [&original_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_proxies_root(original_path: String) -> Result<String, String> {
    proxies_root_for(Path::new(&original_path))
        .map(|p| p.to_string_lossy().into_owned())
}

// ── Directory listing ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub parent_path: Option<String>,
    pub subdirs: Vec<String>,
    pub media_files: Vec<String>,
}

#[tauri::command]
fn list_directory(path: String) -> Result<DirListing, String> {
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
            let ext = entry.path()
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

    Ok(DirListing { path, parent_path, subdirs, media_files })
}

// ── Cache / pin commands (provider-routed) ──────────────────────────────────

/// Provider for the drive containing `path`, looked up in a snapshot of the map.
fn provider_for_map(map: &HashMap<String, cache::Provider>, path: &Path) -> cache::Provider {
    drive_root_of(path)
        .and_then(|root| map.get(&norm_path(&root)).copied())
        .unwrap_or(cache::Provider::Local)
}

/// Sets each drive's provider (Local / Suite / LucidLink). Drives the DB routing
/// and which CLI pin/cache commands get used.
#[tauri::command]
fn set_drive_providers(state: tauri::State<AppState>, providers: HashMap<String, String>) {
    let mut pool = state.0.lock().unwrap();
    pool.drive_providers = providers
        .into_iter()
        .map(|(drive, kind)| (norm_path(&drive), cache::Provider::parse(&kind)))
        .collect();
}

/// Pin / pre-cache each path through its drive's provider.
#[tauri::command]
fn precache_add(state: tauri::State<AppState>, paths: Vec<String>) -> Result<(), String> {
    let providers = { state.0.lock().unwrap().drive_providers.clone() };
    for p in &paths {
        let path = Path::new(p);
        cache::pin(provider_for_map(&providers, path), path)?;
    }
    Ok(())
}

/// Unpin / remove-from-cache each path through its drive's provider.
#[tauri::command]
fn precache_remove(state: tauri::State<AppState>, paths: Vec<String>) -> Result<(), String> {
    let providers = { state.0.lock().unwrap().drive_providers.clone() };
    for p in &paths {
        let path = Path::new(p);
        cache::unpin(provider_for_map(&providers, path), path)?;
    }
    Ok(())
}

/// All currently pinned/pre-cached paths across every managed drive (absolute).
#[tauri::command]
fn precache_list(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    let providers = { state.0.lock().unwrap().drive_providers.clone() };
    let mut result = Vec::new();
    // Suite pre-cache list is global (absolute paths).
    if providers.values().any(|p| *p == cache::Provider::Suite) {
        if let Ok(paths) = cache::suite_list() {
            result.extend(paths);
        }
    }
    // LucidLink pins are per-filespace (relative); absolutize under each drive.
    for (root, p) in &providers {
        if *p == cache::Provider::LucidLink {
            if let Ok(paths) = cache::lucid_list(root) {
                result.extend(paths);
            }
        }
    }
    Ok(result)
}

/// Extracts a single thumbnail frame from a video file using ffmpeg.
/// Stored at `{drive_root}\Levee\Thumbnails\{xx}\{yy}\{hash16}.jpg`.
/// Returns immediately if the file already exists (no ffmpeg needed).
#[tauri::command]
async fn get_thumbnail(
    state: tauri::State<'_, AppState>,
    original_path: String,
) -> Result<String, String> {
    let path  = Path::new(&original_path);
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

    let orig  = original_path.clone();
    let dest  = thumb_str.clone();
    let ffmpeg = resolve_ffmpeg();

    let out = tauri::async_runtime::spawn_blocking(move || {
        quiet_command(&ffmpeg)
            .args([
                "-ss", "00:00:03",
                "-i", &orig,
                "-vframes", "1",
                "-vf", "scale=320:-2",
                "-q:v", "5",
                "-y", &dest,
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !out.status.success() || !thumb.exists() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .lines().last().unwrap_or("ffmpeg failed").to_string());
    }

    // Write to DB for shared discovery on Suite drives
    {
        let mut pool = state.0.lock().unwrap();
        let db = pool.db_for(path);
        let _ = db.execute(
            "INSERT INTO thumbnails (original_path, thumbnail_path)
             VALUES (?1, ?2)
             ON CONFLICT(original_path) DO UPDATE SET
               thumbnail_path = excluded.thumbnail_path,
               created_at = strftime('%s','now')",
            params![original_path, thumb_str],
        );
    }

    Ok(thumb_str)
}

/// Returns all mounted drive roots (Windows: A:\–Z:\; macOS: /Volumes/*).
#[tauri::command]
fn list_drives() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        ('A'..='Z')
            .filter_map(|c| {
                let path = format!("{}:\\", c);
                if std::path::Path::new(&path).exists() { Some(path) } else { None }
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

/// Pins the `Levee\Proxies` folder on the asset's drive via that drive's provider
/// (Suite pre-cache or LucidLink pin), so the whole team's proxies stay cached.
#[tauri::command]
fn precache_proxies_folder(state: tauri::State<AppState>, original_path: String) -> Result<(), String> {
    let root = proxies_root_for(Path::new(&original_path))?;
    if !root.exists() { return Ok(()); }
    let provider = { state.0.lock().unwrap().provider_for(&root) };
    cache::pin(provider, &root)
}


// ── mpv playback state + control plane ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MpvPlayerState {
    pub time_pos: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: f64,
    pub speed: f64,
    pub eof: bool,
}

/// Property-observe reply ids (arbitrary, used to route property-change events).
const OBS_TIME_POS: u64 = 1;
const OBS_DURATION: u64 = 2;
const OBS_PAUSE: u64 = 3;
const OBS_EOF: u64 = 4;
const OBS_SPEED: u64 = 5;
const OBS_VOLUME: u64 = 6;

/// Spawns the mpv event-pump thread: observes key properties and emits
/// "mpv-state" to the frontend whenever one changes.
#[cfg(windows)]
fn start_mpv_event_thread(handle: mpv::Handle, app: tauri::AppHandle) {
    handle.observe_double(OBS_TIME_POS, "time-pos");
    handle.observe_double(OBS_DURATION, "duration");
    handle.observe_flag(OBS_PAUSE, "pause");
    handle.observe_flag(OBS_EOF, "eof-reached");
    handle.observe_double(OBS_SPEED, "speed");
    handle.observe_double(OBS_VOLUME, "volume");

    std::thread::spawn(move || {
        let mut state = MpvPlayerState { volume: 100.0, speed: 1.0, ..Default::default() };
        loop {
            let ev = unsafe { handle.wait_event(0.5) };
            if ev.is_null() {
                continue;
            }
            let ev = unsafe { &*ev };
            match ev.event_id {
                mpv::MPV_EVENT_SHUTDOWN => break,
                mpv::MPV_EVENT_PROPERTY_CHANGE => {
                    let prop = ev.data as *const mpv::mpv_event_property;
                    if prop.is_null() {
                        continue;
                    }
                    let prop = unsafe { &*prop };
                    if prop.format == mpv::MPV_FORMAT_NONE || prop.data.is_null() {
                        continue;
                    }
                    match ev.reply_userdata {
                        OBS_TIME_POS => state.time_pos = unsafe { *(prop.data as *const f64) },
                        OBS_DURATION => state.duration = unsafe { *(prop.data as *const f64) },
                        OBS_SPEED => state.speed = unsafe { *(prop.data as *const f64) },
                        OBS_VOLUME => state.volume = unsafe { *(prop.data as *const f64) },
                        OBS_PAUSE => state.paused = unsafe { *(prop.data as *const std::ffi::c_int) } != 0,
                        OBS_EOF => state.eof = unsafe { *(prop.data as *const std::ffi::c_int) } != 0,
                        _ => continue,
                    }
                    let _ = app.emit("mpv-state", state.clone());
                }
                _ => {}
            }
        }
    });
}

#[cfg(windows)]
fn mpv_handle(state: &tauri::State<MpvState>) -> mpv::Handle {
    state.handle
}

#[tauri::command]
fn mpv_load(state: tauri::State<MpvState>, path: String) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).command(&["loadfile", &path]) }
    #[cfg(not(windows))]
    { let _ = (&state, path); Err("mpv only available on Windows".into()) }
}

#[tauri::command]
fn mpv_set_pause(state: tauri::State<MpvState>, paused: bool) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).set_flag("pause", paused) }
    #[cfg(not(windows))]
    { let _ = (&state, paused); Ok(()) }
}

#[tauri::command]
fn mpv_seek(state: tauri::State<MpvState>, time: f64) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).command(&["seek", &time.to_string(), "absolute"]) }
    #[cfg(not(windows))]
    { let _ = (&state, time); Ok(()) }
}

#[tauri::command]
fn mpv_seek_by(state: tauri::State<MpvState>, delta: f64) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).command(&["seek", &delta.to_string(), "relative"]) }
    #[cfg(not(windows))]
    { let _ = (&state, delta); Ok(()) }
}

#[tauri::command]
fn mpv_frame_step(state: tauri::State<MpvState>, direction: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let cmd = if direction >= 0 { "frame-step" } else { "frame-back-step" };
        mpv_handle(&state).command(&[cmd])
    }
    #[cfg(not(windows))]
    { let _ = (&state, direction); Ok(()) }
}

#[tauri::command]
fn mpv_set_volume(state: tauri::State<MpvState>, volume: f64) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).set_double("volume", volume.clamp(0.0, 130.0)) }
    #[cfg(not(windows))]
    { let _ = (&state, volume); Ok(()) }
}

#[tauri::command]
fn mpv_set_mute(state: tauri::State<MpvState>, muted: bool) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).set_flag("mute", muted) }
    #[cfg(not(windows))]
    { let _ = (&state, muted); Ok(()) }
}

#[tauri::command]
fn mpv_set_speed(state: tauri::State<MpvState>, speed: f64) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).set_double("speed", speed) }
    #[cfg(not(windows))]
    { let _ = (&state, speed); Ok(()) }
}

#[tauri::command]
fn mpv_set_loop(state: tauri::State<MpvState>, looping: bool) -> Result<(), String> {
    #[cfg(windows)]
    { mpv_handle(&state).set_string("loop-file", if looping { "inf" } else { "no" }) }
    #[cfg(not(windows))]
    { let _ = (&state, looping); Ok(()) }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Give the process an explicit AppUserModelID so Windows groups the taskbar
    // button under Levee's identity and uses our window icon (not a generic one).
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from("com.levee.app"));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second instance was launched (e.g. user opened a file while Levee is running).
            // Bring the existing window to front and forward the file argument.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let file_args: Vec<String> = argv.into_iter()
                .skip(1)
                .filter(|a| !a.starts_with("--") && Path::new(a.as_str()).exists())
                .collect();
            if !file_args.is_empty() {
                let _ = app.emit("open-file", file_args);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Explicitly (re)apply the window icon so the taskbar uses the
            // current branded icon regardless of what got embedded at build time.
            if let (Some(win), Some(icon)) =
                (app.get_webview_window("main"), app.default_window_icon().cloned())
            {
                let _ = win.set_icon(icon);
            }

            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let local_db_path = data_dir.join("levee.db");
            let local = Connection::open(&local_db_path)
                .expect("failed to open local database");
            local.execute_batch(SCHEMA)
                .expect("failed to run schema migration");

            app.manage(AppState(Mutex::new(DbPool {
                local,
                managed: HashMap::new(),
                drive_providers: HashMap::new(),
            })));

            // ── Native mpv video pipeline ─────────────────────────────────────
            // Load libmpv, create the player, start the DComp video surface and
            // the event-pump thread.
            #[cfg(windows)]
            {
                use std::sync::atomic::AtomicU64;
                match mpv::load().and_then(|_| mpv::Handle::create()) {
                    Ok(handle) => {
                        app.manage(MpvState { handle });
                        if let Some(win) = app.get_webview_window("main") {
                            let hwnd = win.hwnd().expect("main HWND").0 as isize;
                            let size = win.inner_size().unwrap_or(tauri::PhysicalSize::new(1280, 720));

                            // Shared latest-window-size; the render thread resizes
                            // its swapchain to match when this changes.
                            let resize = std::sync::Arc::new(AtomicU64::new(
                                dcomp::pack_size(size.width, size.height),
                            ));
                            dcomp::start(hwnd, size.width, size.height, handle, resize.clone());

                            // Push physical-pixel size changes to the render thread.
                            win.on_window_event(move |event| {
                                if let tauri::WindowEvent::Resized(sz) = event {
                                    if sz.width > 0 && sz.height > 0 {
                                        resize.store(
                                            dcomp::pack_size(sz.width, sz.height),
                                            std::sync::atomic::Ordering::Relaxed,
                                        );
                                    }
                                }
                            });
                        }
                        start_mpv_event_thread(handle, app.handle().clone());
                        eprintln!("[mpv] player initialized");
                    }
                    Err(e) => eprintln!("[mpv] init failed: {e}"),
                }
            }

            // Capture a launch file argument (file association / CLI). The
            // frontend pulls this via `take_launch_file` once it mounts, which is
            // race-free unlike a fire-and-forget event on a slow cold start.
            let launch_file = std::env::args()
                .skip(1)
                .find(|a| !a.starts_with("--") && Path::new(a).exists());
            app.manage(PendingOpen(Mutex::new(launch_file)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_file,
            take_launch_file,
            set_as_default_player,
            open_url,
            get_sibling_files,
            get_file_size,
            open_folder,
            get_probe_data,
            get_proxy,
            generate_proxy,
            get_proxies_root,
            set_drive_providers,
            precache_add,
            precache_remove,
            precache_list,
            precache_proxies_folder,
            list_directory,
            get_proxies_batch,
            delete_proxy,
            list_drives,
            get_thumbnail,
            // mpv native player
            mpv_load,
            mpv_set_pause,
            mpv_seek,
            mpv_seek_by,
            mpv_frame_step,
            mpv_set_volume,
            mpv_set_mute,
            mpv_set_speed,
            mpv_set_loop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Levee");
}
