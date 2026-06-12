use std::path::Path;
use crate::process_tools::quiet_command;
use crate::proxy_paths::proxies_root_for;
use crate::AppState;

// ── Suite commands ────────────────────────────────────────────────────────────

fn run_suite_cmd(args: &[&str]) -> std::io::Result<std::process::Output> {
    quiet_command("suite").args(args).output()
}

/// Updates the in-memory list of Suite roots used for DB routing.
#[tauri::command]
pub(crate) fn set_suite_roots(state: tauri::State<AppState>, roots: Vec<String>) {
    state.set_suite_roots(roots);
}

#[tauri::command]
pub(crate) fn suite_precache_add(paths: Vec<String>) -> Result<String, String> {
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
pub(crate) fn suite_precache_remove(paths: Vec<String>) -> Result<String, String> {
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
pub(crate) fn suite_precache_list() -> Result<Vec<String>, String> {
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
/// Tells Suite to pre-cache the `Levee\Proxies` folder on the same drive as the file.
#[tauri::command]
pub(crate) fn precache_proxies_folder(original_path: String) -> Result<(), String> {
    let root = proxies_root_for(Path::new(&original_path))?;
    if !root.exists() { return Ok(()); }
    let path_str = root.to_string_lossy().into_owned();
    let out = run_suite_cmd(&["pre-cache", "add", "--path", &path_str])
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}