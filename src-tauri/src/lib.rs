mod dcomp;
mod mpv;
mod media_format;
mod proxy_paths;
mod process_tools;
mod media_probe;
mod file_commands;
mod suite_commands;
mod proxy_commands;
mod thumbnail_commands;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::{Emitter, Manager};
use media_probe::get_probe_data;
use file_commands::{get_file_size, get_sibling_files, list_directory, list_drives, open_folder, open_url, pick_file, set_as_default_player};
use suite_commands::{precache_proxies_folder, set_suite_roots, suite_precache_add, suite_precache_list, suite_precache_remove};
use proxy_commands::{delete_proxy, generate_proxy, get_proxies_batch, get_proxies_root, get_proxy};
use thumbnail_commands::get_thumbnail;

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
                    let db_path = Path::new(root).join("Levee").join("levee.db");
                    if let Some(dir) = db_path.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
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

impl AppState {
    pub(crate) fn set_suite_roots(&self, roots: Vec<String>) {
        self.0.lock().unwrap().suite_roots = roots;
    }

    pub(crate) fn record_proxy(&self, original_path: &str, proxy_path: &str) {
        let mut pool = self.0.lock().unwrap();
        let db = pool.db_for(Path::new(original_path));
        let _ = db.execute(
            "INSERT INTO proxies (original_path, proxy_path)
             VALUES (?1, ?2)
             ON CONFLICT(original_path) DO UPDATE SET
               proxy_path = excluded.proxy_path,
               created_at = strftime('%s','now')",
            params![original_path, proxy_path],
        );
    }

    pub(crate) fn delete_proxy_record(&self, original_path: &str) -> Result<(), String> {
        let mut pool = self.0.lock().unwrap();
        let db = pool.db_for(Path::new(original_path));
        db.execute("DELETE FROM proxies WHERE original_path = ?1", [original_path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(crate) fn record_thumbnail(&self, original_path: &str, thumbnail_path: &str) {
        let mut pool = self.0.lock().unwrap();
        let db = pool.db_for(Path::new(original_path));
        let _ = db.execute(
            "INSERT INTO thumbnails (original_path, thumbnail_path)
             VALUES (?1, ?2)
             ON CONFLICT(original_path) DO UPDATE SET
               thumbnail_path = excluded.thumbnail_path,
               created_at = strftime('%s','now')",
            params![original_path, thumbnail_path],
        );
    }
}

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

/// Returns (and clears) the file the app was launched with, if any.
/// Called by the frontend on mount to open files from associations/CLI.
#[tauri::command]
fn take_launch_file(pending: tauri::State<PendingOpen>) -> Option<String> {
    pending.0.lock().unwrap().take()
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
                suite: HashMap::new(),
                suite_roots: vec![],
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
            set_suite_roots,
            suite_precache_add,
            suite_precache_remove,
            suite_precache_list,
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
