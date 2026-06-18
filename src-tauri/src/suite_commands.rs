use crate::cache;
use crate::proxy_paths::proxies_root_for;
use crate::AppState;
use std::collections::HashMap;
use std::path::Path;

// ── Cache / pin commands (provider-routed: Suite or LucidLink) ──────────────

/// Sets each drive's provider (Local / Suite / LucidLink). Drives the DB routing
/// and which CLI pin/cache commands get used.
#[tauri::command]
pub(crate) fn set_drive_providers(
    state: tauri::State<AppState>,
    providers: HashMap<String, String>,
) {
    state.set_drive_providers(providers);
}

fn provider_for_map(map: &HashMap<String, cache::Provider>, path: &Path) -> cache::Provider {
    crate::drive_root_of(path)
        .and_then(|root| map.get(&crate::norm_path(&root)).copied())
        .unwrap_or(cache::Provider::Local)
}

/// Pin / pre-cache each path through its drive's provider.
#[tauri::command]
pub(crate) fn precache_add(
    state: tauri::State<AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let providers = state.drive_providers_snapshot();
    for p in &paths {
        let path = Path::new(p);
        cache::pin(provider_for_map(&providers, path), path)?;
    }
    Ok(())
}

/// Unpin / remove-from-cache each path through its drive's provider.
#[tauri::command]
pub(crate) fn precache_remove(
    state: tauri::State<AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let providers = state.drive_providers_snapshot();
    for p in &paths {
        let path = Path::new(p);
        cache::unpin(provider_for_map(&providers, path), path)?;
    }
    Ok(())
}

/// All currently pinned/pre-cached paths across every managed drive (absolute).
#[tauri::command]
pub(crate) fn precache_list(state: tauri::State<AppState>) -> Result<Vec<String>, String> {
    let providers = state.drive_providers_snapshot();
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

/// Pins the `Levee\Proxies` folder on the asset's drive via that drive's provider,
/// so the whole team's proxies stay cached.
#[tauri::command]
pub(crate) fn precache_proxies_folder(
    state: tauri::State<AppState>,
    original_path: String,
) -> Result<(), String> {
    let root = proxies_root_for(Path::new(&original_path))?;
    if !root.exists() {
        return Ok(());
    }
    let provider = state.provider_for(&root);
    cache::pin(provider, &root)
}
