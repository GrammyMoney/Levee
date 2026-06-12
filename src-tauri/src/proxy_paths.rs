use std::path::{Path, PathBuf};

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
pub(crate) fn proxies_root_for(original: &Path) -> Result<PathBuf, String> {
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
pub(crate) fn thumbnails_root_for(original: &Path) -> Result<PathBuf, String> {
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
pub(crate) fn proxy_path_for(original: &Path) -> Result<PathBuf, String> {
    let root = proxies_root_for(original)?;
    let hash = format!("{:016x}", fnv1a(&norm_for_hash(original)));
    Ok(root.join(&hash[0..2]).join(&hash[2..4]).join(format!("{hash}.mp4")))
}

/// Deterministic hashed path for a thumbnail.
/// `{drive_root}\Levee\Thumbnails\{xx}\{yy}\{hash16}.jpg`
pub(crate) fn thumbnail_path_for(original: &Path) -> Result<PathBuf, String> {
    let root = thumbnails_root_for(original)?;
    let hash = format!("{:016x}", fnv1a(&norm_for_hash(original)));
    Ok(root.join(&hash[0..2]).join(&hash[2..4]).join(format!("{hash}.jpg")))
}
