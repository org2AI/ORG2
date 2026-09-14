//! LRU cache for recent search results.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
static EPOCH: AtomicU64 = AtomicU64::new(0);

use lru::LruCache;
use tracing::info;

use super::types::CodeSearchResult;

/// Cache key for search results.
#[derive(Clone, Eq, PartialEq, Hash)]
pub(super) struct SearchCacheKey {
    query: String,
    repo_path: String,
    filters: super::types::SearchFilters,
    fingerprint: u64,
    epoch: u64,
}

impl SearchCacheKey {
    pub(super) fn new(query: &str, repo_path: &str, filters: &super::types::SearchFilters) -> Self {
        Self {
            query: query.to_string(),
            repo_path: repo_path.to_string(),
            filters: super::types::SearchFilters {
                case_sensitive: Some(filters.case_sensitive.unwrap_or(false)),
                whole_word: Some(filters.whole_word.unwrap_or(false)),
                use_regex: Some(filters.use_regex.unwrap_or(false)),
                max_results: Some(filters.max_results.unwrap_or(10000)),
                ..filters.clone()
            },
            fingerprint: 0,
            epoch: EPOCH.load(Ordering::Acquire),
        }
    }

    pub(super) fn with_fingerprint(mut self, fingerprint: u64) -> Self {
        self.fingerprint = fingerprint;
        self
    }

    pub(super) fn hash_key(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.hash(&mut hasher);
        hasher.finish()
    }
}

/// Cached search result.
#[derive(Clone)]
pub(super) struct CachedSearchResult {
    pub(super) results: Vec<CodeSearchResult>,
    pub(super) total_matches: usize,
    pub(super) total_files: usize,
    pub(super) limit_hit: bool,
    pub(super) bytes: usize,
    pub(super) cached_at: std::time::Instant,
}

/// LRU cache for recent search results (max 20 entries).
static SEARCH_CACHE: std::sync::LazyLock<RwLock<LruCache<u64, CachedSearchResult>>> =
    std::sync::LazyLock::new(|| RwLock::new(LruCache::new(NonZeroUsize::new(20).unwrap())));

/// Check if a search result is cached and still valid (5 minute TTL).
pub(super) fn get_cached_result(key: &SearchCacheKey) -> Option<CachedSearchResult> {
    let hash = key.hash_key();
    let mut cache = SEARCH_CACHE.write().unwrap();
    if let Some(cached) = cache.get(&hash) {
        if cached.cached_at.elapsed().as_secs() < 300 {
            return Some(cached.clone());
        }
    }
    None
}

/// Store a search result in the cache.
pub(super) fn cache_result(
    key: &SearchCacheKey,
    results: Vec<CodeSearchResult>,
    total_matches: usize,
    total_files: usize,
    limit_hit: bool,
) {
    if key.epoch != EPOCH.load(Ordering::Acquire) {
        return;
    }
    let bytes = results
        .iter()
        .map(|r| {
            128 + 6 * r.file_path.len()
                + r.matches
                    .iter()
                    .map(|m| {
                        256 + 6 * (m.text.len() + m.context_before.len() + m.context_after.len())
                    })
                    .sum::<usize>()
        })
        .sum::<usize>();
    if bytes > 4 * 1024 * 1024 {
        return;
    }
    let hash = key.hash_key();
    let cached = CachedSearchResult {
        results,
        total_matches,
        total_files,
        limit_hit,
        bytes,
        cached_at: std::time::Instant::now(),
    };
    let mut cache = SEARCH_CACHE.write().unwrap();
    if key.epoch != EPOCH.load(Ordering::Acquire) {
        return;
    }
    cache.put(hash, cached);
    while cache.iter().map(|(_, value)| value.bytes).sum::<usize>() > 16 * 1024 * 1024 {
        cache.pop_lru();
    }
}

/// Clear the search cache (called when files change).
#[tauri::command]
pub fn clear_search_cache() {
    let mut cache = SEARCH_CACHE.write().unwrap();
    EPOCH.fetch_add(1, Ordering::AcqRel);
    cache.clear();
    info!("search::cache: cache cleared");
}
