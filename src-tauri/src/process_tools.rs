use std::path::{Path, PathBuf};
use tauri::Manager;

/// Build a process Command that does NOT flash a console window on Windows.
/// (CREATE_NO_WINDOW = 0x08000000.) Used for every external tool we spawn.
pub(crate) fn quiet_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
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
pub(crate) fn resolve_ffmpeg() -> String {
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
pub(crate) fn ffprobe_binary(app: &tauri::AppHandle) -> PathBuf {
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
