//! One bounded search engine for batch, streaming and fast adapters.
use super::cache::{self, SearchCacheKey};
use super::helpers::{
    collect_files_bounded_at, get_same_line_context, register_search, unregister_search,
    MAX_FILE_BYTES, MAX_SCAN_TIME,
};
use super::types::{CodeSearchMatch, CodeSearchResult, SearchFilters};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;

pub(super) const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESULTS: usize = 20_000;
const MAX_SCANNED_BYTES: u64 = 128 * 1024 * 1024;
static WORKERS: AtomicUsize = AtomicUsize::new(0);
struct SearchBudget {
    started: Instant,
    scanned_bytes: u64,
    glob_root: Option<String>,
}
struct Permit;
impl Permit {
    fn acquire() -> Result<Self, String> {
        WORKERS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < 4).then_some(n + 1)
            })
            .map(|_| Self)
            .map_err(|_| "Search workers are busy; retry after pending searches finish".into())
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        WORKERS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Clone)]
pub struct FastSearchOutcome {
    pub results: Vec<CodeSearchResult>,
    pub total_matches: usize,
    pub total_files: usize,
    pub total_files_searched: usize,
    pub limit_hit: bool,
    pub cancelled: bool,
    pub budget_exhausted: bool,
}
pub fn search_code_fast_inner(
    query: &str,
    repo_path: &str,
    filters: SearchFilters,
    cancelled: Option<Arc<AtomicBool>>,
) -> Result<FastSearchOutcome, String> {
    search_code_fast_inner_with_handlers(query, repo_path, filters, cancelled, |_| {}, |_, _, _| {})
}
pub fn search_code_fast_inner_with_handlers<F, S>(
    query: &str,
    repo_path: &str,
    filters: SearchFilters,
    cancelled: Option<Arc<AtomicBool>>,
    on_files_collected: S,
    on_result: F,
) -> Result<FastSearchOutcome, String>
where
    F: Fn(CodeSearchResult, usize, usize) + Send + Sync,
    S: Fn(usize) + Send + Sync,
{
    let _permit = Permit::acquire()?;
    search_code_at(
        query,
        repo_path,
        filters,
        cancelled,
        on_files_collected,
        on_result,
        &mut SearchBudget {
            started: Instant::now(),
            scanned_bytes: 0,
            glob_root: None,
        },
    )
}
fn search_code_at<F, S>(
    query: &str,
    repo_path: &str,
    filters: SearchFilters,
    cancelled: Option<Arc<AtomicBool>>,
    on_files_collected: S,
    on_result: F,
    budget: &mut SearchBudget,
) -> Result<FastSearchOutcome, String>
where
    F: Fn(CodeSearchResult, usize, usize) + Send + Sync,
    S: Fn(usize) + Send + Sync,
{
    let started = budget.started;
    let cancelled = cancelled.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    if query.len() > 4096 {
        return Err("Search query exceeds 4096 bytes".into());
    }
    let root = Path::new(repo_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {repo_path}"));
    }
    let max_results = filters.max_results.unwrap_or(10000).min(MAX_RESULTS);
    let mut pattern = if filters.use_regex.unwrap_or(false) {
        query.into()
    } else {
        regex::escape(query)
    };
    if filters.whole_word.unwrap_or(false) {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!filters.case_sensitive.unwrap_or(false))
        .size_limit(2 * 1024 * 1024)
        .build()
        .map_err(|e| format!("Invalid search pattern: {e}"))?;
    let glob_root = budget.glob_root.as_deref().map(Path::new).unwrap_or(root);
    let collected = collect_files_bounded_at(root, &filters, &cancelled, started, glob_root)?;
    let total_files_searched = collected.files.len();
    on_files_collected(total_files_searched);
    let key =
        SearchCacheKey::new(query, repo_path, &filters).with_fingerprint(collected.fingerprint);
    if !collected.truncated && !cancelled.load(Ordering::Relaxed) {
        if let Some(cached) = cache::get_cached_result(&key) {
            for result in &cached.results {
                if cancelled.load(Ordering::Relaxed) {
                    break;
                }
                on_result(result.clone(), cached.total_matches, cached.total_files);
            }
            return Ok(FastSearchOutcome {
                results: cached.results,
                total_matches: cached.total_matches,
                total_files: cached.total_files,
                total_files_searched,
                limit_hit: cached.limit_hit,
                cancelled: cancelled.load(Ordering::Relaxed),
                budget_exhausted: false,
            });
        }
    }
    let mut outcome = FastSearchOutcome {
        results: Vec::new(),
        total_matches: 0,
        total_files: 0,
        total_files_searched,
        limit_hit: false,
        cancelled: false,
        budget_exhausted: collected.truncated,
    };
    let mut result_bytes = 0;

    for path in &collected.files {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        if outcome.total_matches >= max_results {
            outcome.limit_hit = true;
            break;
        }
        if started.elapsed() >= MAX_SCAN_TIME {
            outcome.budget_exhausted = true;
            break;
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(_) => {
                outcome.budget_exhausted = true;
                continue;
            }
        };
        let mut reader = file.take(MAX_FILE_BYTES + 1);
        // Bounded reads let cancellation stop within a file, including files
        // with no matches. Never read an unbounded line into a String.
        let mut chunk = [0_u8; 16 * 1024];
        loop {
            if cancelled.load(Ordering::Relaxed) || started.elapsed() >= MAX_SCAN_TIME {
                break;
            }
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    bytes.extend_from_slice(&chunk[..n]);
                    budget.scanned_bytes += n as u64;
                    if budget.scanned_bytes > MAX_SCANNED_BYTES {
                        break;
                    }
                }
                Err(_) => {
                    outcome.budget_exhausted = true;
                    break;
                }
            }
        }
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        if budget.scanned_bytes > MAX_SCANNED_BYTES || started.elapsed() >= MAX_SCAN_TIME {
            outcome.budget_exhausted = true;
            break;
        }
        if bytes.len() as u64 > MAX_FILE_BYTES {
            outcome.budget_exhausted = true;
            continue;
        }
        if bytes.contains(&0) {
            continue;
        }
        let Ok(content) = std::str::from_utf8(&bytes) else {
            continue;
        };
        let path_cost = 128 + 6 * path.as_os_str().len();
        if result_bytes + path_cost > MAX_RESULT_BYTES {
            outcome.budget_exhausted = true;
            break;
        }
        result_bytes += path_cost;
        let mut matches = Vec::new();
        for (line_index, line) in content.lines().enumerate() {
            if cancelled.load(Ordering::Relaxed) || started.elapsed() >= MAX_SCAN_TIME {
                break;
            }
            let mut previous_end = 0;
            let mut previous_utf16 = 0;
            for hit in re.find_iter(line) {
                if cancelled.load(Ordering::Relaxed) || started.elapsed() >= MAX_SCAN_TIME {
                    break;
                }
                let column =
                    previous_utf16 + line[previous_end..hit.start()].encode_utf16().count() + 1;
                let end_column = column + hit.as_str().encode_utf16().count();
                previous_end = hit.end();
                previous_utf16 = end_column - 1;
                if outcome.total_matches >= max_results {
                    outcome.limit_hit = true;
                    break;
                }
                if hit.len() > 4096 {
                    outcome.budget_exhausted = true;
                    continue;
                }
                let (context_before, context_after) =
                    get_same_line_context(line, hit.start(), hit.end());
                let matched = CodeSearchMatch {
                    line: line_index + 1,
                    column,
                    end_line: line_index + 1,
                    end_column,
                    text: hit.as_str().into(),
                    context_before,
                    context_after,
                };
                // Conservatively bound JSON escaping and field/position overhead.
                let cost = 256
                    + 6 * (matched.text.len()
                        + matched.context_before.len()
                        + matched.context_after.len());
                if result_bytes + cost > MAX_RESULT_BYTES {
                    outcome.budget_exhausted = true;
                    break;
                }
                result_bytes += cost;
                matches.push(matched);
                outcome.total_matches += 1;
            }
            if outcome.limit_hit || result_bytes + 256 >= MAX_RESULT_BYTES {
                break;
            }
        }
        if !matches.is_empty() {
            let result = CodeSearchResult {
                file_path: path.to_string_lossy().into(),
                matches,
            };
            outcome.total_files += 1;
            on_result(result.clone(), outcome.total_matches, outcome.total_files);
            outcome.results.push(result);
        }
        if outcome.budget_exhausted && result_bytes > MAX_RESULT_BYTES.saturating_sub(8192) {
            break;
        }
    }
    outcome.cancelled = cancelled.load(Ordering::Relaxed);
    outcome.limit_hit |= outcome.total_matches >= max_results;
    outcome.budget_exhausted |= started.elapsed() >= MAX_SCAN_TIME;
    if !outcome.cancelled && !outcome.budget_exhausted {
        // A file changing during the read must not install a mixed-generation result.
        let after = collect_files_bounded_at(root, &filters, &cancelled, started, glob_root)?;
        if !after.truncated
            && after.fingerprint == collected.fingerprint
            && !cancelled.load(Ordering::Relaxed)
        {
            cache::cache_result(
                &key,
                outcome.results.clone(),
                outcome.total_matches,
                outcome.total_files,
                outcome.limit_hit,
            );
        }
    }
    outcome.cancelled = cancelled.load(Ordering::Relaxed);
    Ok(outcome)
}

#[tauri::command]
pub async fn search_code_regex(
    query: String,
    repo_paths: Vec<String>,
    filters: Option<SearchFilters>,
    search_id: Option<String>,
    repo_root: Option<String>,
) -> Result<Vec<CodeSearchResult>, String> {
    let cancelled = match &search_id {
        Some(id) => register_search(id)?,
        None => Arc::new(AtomicBool::new(false)),
    };
    tokio::task::spawn_blocking(move || {
        scopeguard::defer! { if let Some(id) = &search_id { unregister_search(id); } }
        let _permit = Permit::acquire()?;
        let started = Instant::now();
        let mut budget = SearchBudget {
            started,
            scanned_bytes: 0,
            glob_root: repo_root,
        };
        if repo_paths.len() > 100 {
            return Err("Too many search roots".into());
        }
        let mut filters = filters.unwrap_or_default();
        let limit = filters.max_results.unwrap_or(500).min(MAX_RESULTS);
        let mut results = Vec::new();
        let mut count = 0;
        let mut bytes = 0;
        for root in repo_paths {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Search cancelled".into());
            }
            if started.elapsed() >= MAX_SCAN_TIME {
                return Err("Search time budget exceeded".into());
            }
            filters.max_results = Some(limit.saturating_sub(count));
            let outcome = search_code_at(
                &query,
                &root,
                filters.clone(),
                Some(cancelled.clone()),
                |_| {},
                |_, _, _| {},
                &mut budget,
            )?;
            if outcome.cancelled {
                return Err("Search cancelled".into());
            }
            if outcome.budget_exhausted {
                return Err("Search exceeded its resource budget; narrow the search scope".into());
            }
            count += outcome.total_matches;
            bytes += serde_json::to_vec(&outcome.results)
                .map_err(|e| e.to_string())?
                .len();
            if bytes > MAX_RESULT_BYTES {
                return Err(
                    "Search results exceed the byte budget; narrow the search scope".into(),
                );
            }
            results.extend(outcome.results);
            if count >= limit {
                break;
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| format!("Search worker failed: {e}"))?
}

#[tauri::command]
pub async fn search_code_streaming(
    window: tauri::Window,
    search_id: String,
    query: String,
    repo_path: String,
    filters: Option<SearchFilters>,
) -> Result<(), String> {
    search_code_fast(window, search_id, query, repo_path, filters).await
}

#[tauri::command]
pub async fn search_code_fast(
    window: tauri::Window,
    search_id: String,
    query: String,
    repo_path: String,
    filters: Option<SearchFilters>,
) -> Result<(), String> {
    let cancelled = register_search(&search_id)?;
    // Move cleanup into the worker: dropping the IPC future must not orphan
    // its registry entry while the blocking work still owns the request.
    tokio::task::spawn_blocking(move || {
        scopeguard::defer! { unregister_search(&search_id); }
        let started = Instant::now();
        let outcome = search_code_fast_inner_with_handlers(&query, &repo_path, filters.unwrap_or_default(), Some(cancelled.clone()),
            |count| { let _ = window.emit("search-started", serde_json::json!({"search_id": search_id, "total_files": count})); },
            |result, matches, files| { if !cancelled.load(Ordering::Relaxed) { let _ = window.emit("search-result", serde_json::json!({"search_id": search_id, "result": result, "actual_matches": matches, "actual_files": files, "emitted_matches": matches, "emitted_files": files})); } })?;
        let _ = window.emit("search-complete", serde_json::json!({"search_id": search_id, "total_matches": outcome.total_matches, "total_files": outcome.total_files, "emitted_matches": outcome.total_matches, "emitted_files": outcome.total_files, "duration_ms": started.elapsed().as_millis(), "has_more": outcome.limit_hit && !outcome.budget_exhausted && !outcome.cancelled, "limit_hit": outcome.limit_hit, "cancelled": outcome.cancelled, "budget_exhausted": outcome.budget_exhausted}));
        Ok(())
    }).await.map_err(|e| format!("Search worker failed: {e}"))?
}
