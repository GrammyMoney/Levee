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

// Schema for levee.db — stored either at Suite drive root or app-local fallback.
// Only proxies table needed; no asset metadata stored here.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS proxies (
    original_path TEXT PRIMARY KEY,
    proxy_path    TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
";

// ── App state ─────────────────────────────────────────────────────────────────

struct DbPool {
    local: Connection,
    /// Keyed by normalized drive root e.g. "S:\\"
    suite: HashMap<String, Connection>,
    /// User-configured Suite mount roots
    suite_roots: Vec<String>,
}

impl DbPool {
    /// Returns a mutable reference to the DB appropriate for the given file path.
    /// If the file is on a known Suite root, opens (or reuses) that root's levee.db.
    /// Falls back to the local DB otherwise.
    fn db_for(&mut self, path: &Path) -> &mut Connection {
        let root = drive_root_of(path);
        if let Some(ref root) = root {
            let norm = norm_path(root);
            let is_suite = self.suite_roots.iter().any(|r| norm_path(r) == norm);
            if is_suite {
                if !self.suite.contains_key(root) {
                    let db_path = Path::new(root).join("levee.db");
                    if let Ok(conn) = Connection::open(&db_path) {
                        let _ = conn.execute_batch(SCHEMA);
                        self.suite.insert(root.clone(), conn);
                    }
                }
                if self.suite.contains_key(root) {
                    return self.suite.get_mut(root).unwrap();
                }
            }
        }
        &mut self.local
    }
}

struct AppState(Mutex<DbPool>);

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
    let output = std::process::Command::new(&ffprobe)
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

/// Returns the `Levee Proxies` root on the same drive as `original`.
fn proxies_root_for(original: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    match original.components().next() {
        Some(Component::Prefix(p)) => {
            let root = PathBuf::from(format!("{}\\", p.as_os_str().to_string_lossy()));
            Ok(root.join("Levee Proxies"))
        }
        _ => Err(format!("Cannot determine drive root for: {}", original.display())),
    }
}

/// Computes the deterministic proxy path for an original file.
///
/// Structure: `{drive_root}\Levee Proxies\{xx}\{yy}\{hash16}.mp4`
/// where xx/yy are the first two pairs of hex digits of the FNV-1a hash of the
/// normalized original path.  This gives 65 536 buckets — identical to Git's
/// object-store layout — so filesystem performance stays consistent at any scale.
fn proxy_path_for(original: &Path) -> Result<PathBuf, String> {
    let root  = proxies_root_for(original)?;
    let hash  = format!("{:016x}", fnv1a(&norm_for_hash(original)));
    // hash is exactly 16 hex chars; take pairs for the two bucket levels
    let dir1  = &hash[0..2];
    let dir2  = &hash[2..4];
    Ok(root.join(dir1).join(dir2).join(format!("{hash}.mp4")))
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

    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("ffmpeg")
            .args([
                "-i",        &orig,
                "-vf",       "scale=trunc(iw/4)*2:trunc(ih/4)*2",
                "-c:v",      "libx264",
                "-crf",      "23",
                "-preset",   "fast",
                "-pix_fmt",  "yuv420p",
                "-movflags", "+faststart",
                "-c:a",      "aac",
                "-b:a",      "128k",
                "-y",        &proxy,
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !out.status.success() {
        return Err(format!("ffmpeg error: {}", String::from_utf8_lossy(&out.stderr)));
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

// ── Suite commands ────────────────────────────────────────────────────────────

fn run_suite_cmd(args: &[&str]) -> std::io::Result<std::process::Output> {
    std::process::Command::new("suite").args(args).output()
}

/// Returns drive roots (e.g. "S:\\") currently mounted by Suite.
#[tauri::command]
fn get_suite_mounts() -> Vec<String> {
    let Ok(output) = run_suite_cmd(&["drive", "list"]) else { return vec![]; };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut seen = std::collections::HashSet::new();
    let bytes = text.as_bytes();
    for i in 0..bytes.len() {
        let b = bytes[i];
        if b.is_ascii_alphabetic() && i + 1 < bytes.len() && bytes[i + 1] == b':' {
            let prev_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            if prev_ok {
                let letter = (b as char).to_ascii_uppercase();
                let root = format!("{}:\\", letter);
                if Path::new(&root).exists() {
                    seen.insert(root);
                }
            }
        }
    }
    seen.into_iter().collect()
}

/// Updates the in-memory list of Suite roots used for DB routing.
#[tauri::command]
fn set_suite_roots(state: tauri::State<AppState>, roots: Vec<String>) {
    let mut pool = state.0.lock().unwrap();
    pool.suite_roots = roots;
}

#[tauri::command]
fn suite_precache_add(paths: Vec<String>) -> Result<String, String> {
    let mut lines = vec![];
    for path in &paths {
        let out = run_suite_cmd(&["pre-cache", "add", "--path", path])
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("suite pre-cache add failed: {}",
                String::from_utf8_lossy(&out.stderr)));
        }
        lines.push(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    Ok(lines.join("\n"))
}

#[tauri::command]
fn suite_precache_remove(paths: Vec<String>) -> Result<String, String> {
    let mut lines = vec![];
    for path in &paths {
        let out = run_suite_cmd(&["pre-cache", "remove", "--path", path])
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("suite pre-cache remove failed: {}",
                String::from_utf8_lossy(&out.stderr)));
        }
        lines.push(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    Ok(lines.join("\n"))
}

#[tauri::command]
fn suite_precache_list() -> Result<Vec<String>, String> {
    let out = run_suite_cmd(&["pre-cache", "list"]).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse suite output: {e}\nRaw: {text}"))?;
    let entries = json["PreCacheEntries"]
        .as_array()
        .ok_or_else(|| format!("Unexpected JSON structure: {text}"))?;
    let paths = entries
        .iter()
        .filter_map(|entry| {
            let p = entry["Path"].as_str()?;
            Some(p.trim_start_matches('/').replace('/', "\\"))
        })
        .collect();
    Ok(paths)
}

/// Tells Suite to pre-cache the Levee Proxies folder on the same drive as the file.
#[tauri::command]
fn precache_proxies_folder(original_path: String) -> Result<(), String> {
    let root = proxies_root_for(Path::new(&original_path))?;
    if !root.exists() { return Ok(()); }
    let path_str = root.to_string_lossy().into_owned();
    let out = run_suite_cmd(&["pre-cache", "add", "--path", &path_str])
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
                suite: HashMap::new(),
                suite_roots: vec![],
            })));

            // Forward CLI file arguments to the frontend after it mounts
            let file_args: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with("--") && Path::new(a).exists())
                .collect();

            if !file_args.is_empty() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = handle.emit("open-file", file_args);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_file,
            get_sibling_files,
            get_file_size,
            open_folder,
            get_probe_data,
            get_proxy,
            generate_proxy,
            get_proxies_root,
            get_suite_mounts,
            set_suite_roots,
            suite_precache_add,
            suite_precache_remove,
            suite_precache_list,
            precache_proxies_folder,
            list_directory,
            get_proxies_batch,
            delete_proxy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Levee");
}
