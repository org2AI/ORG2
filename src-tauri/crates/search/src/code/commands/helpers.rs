//! Bounded file enumeration and request ownership shared by search adapters.
use super::types::SearchFilters;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

pub(super) const MAX_FILES: usize = 20_000;
pub(super) const MAX_SCAN_TIME: Duration = Duration::from_secs(10);
pub(super) const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
static ACTIVE_SEARCHES: std::sync::LazyLock<RwLock<HashMap<String, Arc<AtomicBool>>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));
// Short-lived, bounded tombstones close the IPC race where cancel arrives
// before its start command has registered. IDs are unique per request.
static CANCELLED_STARTS: std::sync::LazyLock<RwLock<HashMap<String, Instant>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));
pub(super) fn register_search(id: &str) -> Result<Arc<AtomicBool>, String> {
    if id.is_empty() || id.len() > 256 {
        return Err("Invalid search ID length".into());
    }
    let mut active = ACTIVE_SEARCHES.write().unwrap();
    if active.contains_key(id) {
        return Err("Search ID is already active".into());
    }
    if active.len() >= 8 {
        return Err("Too many active searches; retry after cancelling a search".into());
    }
    let was_cancelled = {
        let mut pending = CANCELLED_STARTS.write().unwrap();
        pending.retain(|_, at| at.elapsed() < std::time::Duration::from_secs(30));
        pending.remove(id).is_some()
    };
    let flag = Arc::new(AtomicBool::new(was_cancelled));
    active.insert(id.into(), flag.clone());
    Ok(flag)
}
pub(super) fn unregister_search(id: &str) {
    ACTIVE_SEARCHES.write().unwrap().remove(id);
}
#[tauri::command]
pub fn cancel_search(search_id: String) -> bool {
    if search_id.is_empty() || search_id.len() > 256 {
        return false;
    }
    let active = ACTIVE_SEARCHES.read().unwrap();
    if let Some(flag) = active.get(&search_id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        let mut pending = CANCELLED_STARTS.write().unwrap();
        pending.retain(|_, at| at.elapsed() < std::time::Duration::from_secs(30));
        if pending.len() >= 128 {
            if let Some(oldest) = pending
                .iter()
                .min_by_key(|(_, at)| *at)
                .map(|(id, _)| id.clone())
            {
                pending.remove(&oldest);
            }
        }
        pending.insert(search_id, Instant::now());
        false
    }
}
/// Bounded UTF-8 context. Match offsets remain relative to the original line.
pub(super) fn get_same_line_context(line: &str, start: usize, end: usize) -> (String, String) {
    let before = &line[..start];
    let from = before
        .char_indices()
        .rev()
        .nth(159)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let after = &line[end..];
    let to = after
        .char_indices()
        .nth(160)
        .map(|(i, _)| i)
        .unwrap_or(after.len());
    (before[from..].into(), after[..to].into())
}
pub(super) struct CollectedFiles {
    pub files: Vec<PathBuf>,
    pub fingerprint: u64,
    pub truncated: bool,
}
fn globs(patterns: &Option<Vec<String>>) -> Result<globset::GlobSet, String> {
    let mut builder = globset::GlobSetBuilder::new();
    for pattern in patterns.as_deref().unwrap_or_default() {
        if pattern.len() > 1024 {
            return Err("Search glob is too long".into());
        }
        builder.add(
            globset::GlobBuilder::new(pattern)
                .literal_separator(true)
                .build()
                .map_err(|e| format!("Invalid file glob: {e}"))?,
        );
    }
    builder.build().map_err(|e| e.to_string())
}
pub(super) fn collect_files_bounded(
    root: &Path,
    filters: &SearchFilters,
    cancelled: &AtomicBool,
    started: Instant,
) -> Result<CollectedFiles, String> {
    collect_files_bounded_at(root, filters, cancelled, started, root)
}
pub(super) fn collect_files_bounded_at(
    root: &Path,
    filters: &SearchFilters,
    cancelled: &AtomicBool,
    started: Instant,
    glob_root: &Path,
) -> Result<CollectedFiles, String> {
    if filters
        .include_globs
        .as_ref()
        .is_some_and(|v| v.len() > 100)
        || filters
            .exclude_globs
            .as_ref()
            .is_some_and(|v| v.len() > 100)
    {
        return Err("Too many search globs".into());
    }
    let includes = globs(&filters.include_globs)?;
    let excludes = globs(&filters.exclude_globs)?;
    let excluded = filters.exclude_dirs.clone().unwrap_or_else(|| {
        [
            "node_modules",
            ".git",
            "target",
            "dist",
            "build",
            ".next",
            "__pycache__",
            ".venv",
            "venv",
        ]
        .map(String::from)
        .to_vec()
    });
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false);
    builder.filter_entry(move |e| {
        !e.file_type().is_some_and(|t| t.is_dir())
            || !excluded
                .iter()
                .any(|name| e.file_name() == std::ffi::OsStr::new(name))
    });
    let mut files = Vec::new();
    let mut paths_bytes = 0;
    let mut visited = 0;
    let mut truncated = false;
    // Check before obtaining the iterator's next entry too: cancellation must
    // stop enumeration, not merely skip the subsequent content search.
    let mut walker = builder.build();
    while !cancelled.load(Ordering::Relaxed) {
        if started.elapsed() >= MAX_SCAN_TIME || visited >= MAX_FILES * 4 {
            truncated = true;
            break;
        }
        let Some(entry) = walker.next() else {
            break;
        };
        visited += 1;
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                truncated = true;
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(glob_root)
            .ok()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(path);
        let filename = path.file_name().map(Path::new).unwrap_or(path);
        if (!includes.is_empty() && !includes.is_match(relative) && !includes.is_match(filename))
            || excludes.is_match(relative)
            || excludes.is_match(filename)
        {
            continue;
        }
        let ext = path.extension().and_then(|s| s.to_str());
        let include = match (&filters.file_extensions, ext) {
            (Some(exts), Some(ext)) => exts.iter().any(|e| e.trim_start_matches('.') == ext),
            (Some(_), None) => false,
            (None, Some(ext)) => !BINARY_EXTENSIONS.contains(&ext.to_lowercase().as_str()),
            (None, None) => true,
        };
        if !include {
            continue;
        }
        paths_bytes += path.as_os_str().len();
        if files.len() >= MAX_FILES || paths_bytes > 4 * 1024 * 1024 {
            truncated = true;
            break;
        }
        files.push(path.to_path_buf());
    }
    files.sort();
    let mut fingerprint = std::collections::hash_map::DefaultHasher::new();
    for path in &files {
        if cancelled.load(Ordering::Relaxed) || started.elapsed() >= MAX_SCAN_TIME {
            truncated = true;
            break;
        }
        path.hash(&mut fingerprint);
        match std::fs::metadata(path) {
            Ok(meta) => {
                meta.len().hash(&mut fingerprint);
                meta.modified().ok().hash(&mut fingerprint);
            }
            Err(_) => {
                truncated = true;
            }
        }
    }
    Ok(CollectedFiles {
        files,
        fingerprint: fingerprint.finish(),
        truncated,
    })
}
/// File extensions that are always binary — excluded from the no-filter
/// default so the regex searcher doesn't waste time on them.
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "pdf", "zip", "gz", "tar", "bz2",
    "xz", "7z", "rar", "dmg", "iso", "exe", "dll", "so", "dylib", "a", "o", "rlib", "class", "jar",
    "war", "pyc", "pyo", "wasm", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi",
    "mkv", "wav", "flac", "ogg", "sqlite", "db", "bin", "dat", "pack", "idx",
];
