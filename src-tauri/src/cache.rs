//! Modular cache/pin provider. Dispatches "keep a local copy" (pin / pre-cache)
//! operations to the right streaming-client CLI based on a drive's configured
//! provider:
//!   - Suite     → `suite pre-cache add/remove/list --path <absolute>`
//!   - LucidLink → `lucid pin [--unset] "<path relative to filespace root>"`,
//!                 `lucid pin` (list)
//!   - Local     → no-op

use std::path::Path;
use std::process::Output;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provider {
    Local,
    Suite,
    LucidLink,
}

impl Provider {
    pub fn parse(s: &str) -> Provider {
        match s.to_lowercase().as_str() {
            "suite" => Provider::Suite,
            "lucidlink" | "lucid" => Provider::LucidLink,
            _ => Provider::Local,
        }
    }
    pub fn is_managed(self) -> bool {
        self != Provider::Local
    }
}

fn run(bin: &str, args: &[&str]) -> Result<Output, String> {
    crate::quiet_command(bin)
        .args(args)
        .output()
        .map_err(|e| format!("{bin}: {e}"))
}

fn check(out: Output) -> Result<(), String> {
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// A path relative to its own drive root, e.g. `Y:\A\B.mp4` → `A\B.mp4`.
/// LucidLink commands take paths relative to the filespace (drive) root.
fn relative_to_drive(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    match crate::drive_root_of(path) {
        Some(root) => s.strip_prefix(&root).unwrap_or(&s).to_string(),
        None => s,
    }
}

/// Keep a local copy of `path` (Suite pre-cache / LucidLink pin).
pub fn pin(provider: Provider, path: &Path) -> Result<(), String> {
    match provider {
        Provider::Local => Ok(()),
        Provider::Suite => {
            let abs = path.to_string_lossy().into_owned();
            check(run("suite", &["pre-cache", "add", "--path", &abs])?)
        }
        Provider::LucidLink => {
            let rel = relative_to_drive(path);
            check(run("lucid", &["pin", &rel])?)
        }
    }
}

/// Remove the local copy of `path`.
pub fn unpin(provider: Provider, path: &Path) -> Result<(), String> {
    match provider {
        Provider::Local => Ok(()),
        Provider::Suite => {
            let abs = path.to_string_lossy().into_owned();
            check(run("suite", &["pre-cache", "remove", "--path", &abs])?)
        }
        Provider::LucidLink => {
            let rel = relative_to_drive(path);
            check(run("lucid", &["pin", "--unset", &rel])?)
        }
    }
}

/// All Suite pre-cached paths, as absolute Windows paths.
pub fn suite_list() -> Result<Vec<String>, String> {
    let out = run("suite", &["pre-cache", "list"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse suite list: {e}"))?;
    let entries = json["PreCacheEntries"]
        .as_array()
        .ok_or_else(|| "unexpected suite output".to_string())?;
    Ok(entries
        .iter()
        .filter_map(|e| {
            let p = e["Path"].as_str()?;
            Some(p.trim_start_matches('/').replace('/', "\\"))
        })
        .collect())
}

/// LucidLink pinned paths for the filespace mounted at `drive_root`.
///
/// `lucid pin` prints a fixed-width table of paths relative to the filespace root:
/// ```text
/// PATH                                 STATE
/// PinTest                              Pinned
/// Arbor Hills\tree.MP4                 Pinned
/// ```
/// The PATH column may contain single spaces, but the column gap is 2+ spaces —
/// so we split on the gap and take the first column, skipping the header. Results
/// are absolutized under the drive for matching against asset paths.
pub fn lucid_list(drive_root: &str) -> Result<Vec<String>, String> {
    let out = run("lucid", &["pin"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let root = drive_root.trim_end_matches('\\');
    let mut result = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // First column = relative path (path can have single spaces; the gap to
        // the STATE column is 2+ spaces).
        let rel = line.split("  ").next().unwrap_or("").trim();
        if rel.is_empty() || rel.eq_ignore_ascii_case("path") {
            continue; // header row
        }
        result.push(format!("{}\\{}", root, rel.trim_start_matches('\\')));
    }
    Ok(result)
}
