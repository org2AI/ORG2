use super::cache::*;
use super::types::*;
use std::sync::Mutex;

static CACHE_MUTEX: Mutex<()> = Mutex::new(());

// ============================================
// SearchCacheKey
// ============================================

fn default_filters() -> SearchFilters {
    SearchFilters {
        include_globs: None,
        exclude_globs: None,
        case_sensitive: None,
        use_regex: None,
        max_results: None,
        file_extensions: None,
        exclude_dirs: None,
        whole_word: None,
    }
}

#[test]
fn cache_key_hash_deterministic() {
    let filters = SearchFilters {
        case_sensitive: Some(true),
        use_regex: Some(false),
        max_results: Some(100),
        ..default_filters()
    };
    let key1 = SearchCacheKey::new("query", "/repo", &filters);
    let key2 = SearchCacheKey::new("query", "/repo", &filters);
    assert_eq!(key1.hash_key(), key2.hash_key());
}

#[test]
fn cache_key_hash_different_queries() {
    let filters = default_filters();
    let key_a = SearchCacheKey::new("foo", "/repo", &filters);
    let key_b = SearchCacheKey::new("bar", "/repo", &filters);
    assert_ne!(key_a.hash_key(), key_b.hash_key());
}

#[test]
fn cache_key_hash_different_repos() {
    let filters = default_filters();
    let key_a = SearchCacheKey::new("query", "/repo1", &filters);
    let key_b = SearchCacheKey::new("query", "/repo2", &filters);
    assert_ne!(key_a.hash_key(), key_b.hash_key());
}

#[test]
fn cache_key_hash_different_case_sensitivity() {
    let filters_ci = SearchFilters {
        case_sensitive: Some(false),
        ..default_filters()
    };
    let filters_cs = SearchFilters {
        case_sensitive: Some(true),
        ..default_filters()
    };
    let key_ci = SearchCacheKey::new("query", "/repo", &filters_ci);
    let key_cs = SearchCacheKey::new("query", "/repo", &filters_cs);
    assert_ne!(key_ci.hash_key(), key_cs.hash_key());
}

#[test]
fn cache_key_defaults_none_to_expected_values() {
    let filters_none = default_filters();
    let filters_explicit = SearchFilters {
        case_sensitive: Some(false),
        use_regex: Some(false),
        max_results: Some(10000),
        ..default_filters()
    };
    let key_none = SearchCacheKey::new("q", "/r", &filters_none);
    let key_explicit = SearchCacheKey::new("q", "/r", &filters_explicit);
    assert_eq!(
        key_none.hash_key(),
        key_explicit.hash_key(),
        "None defaults should match explicit defaults"
    );
}

// ============================================
// cache_result / get_cached_result
// ============================================

#[test]
fn cache_store_and_retrieve() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let filters = default_filters();
    let key = SearchCacheKey::new("test_store_retrieve_unique", "/repo_test_unique", &filters);

    let results = vec![CodeSearchResult {
        file_path: "test.rs".to_string(),
        matches: vec![CodeSearchMatch {
            line: 10,
            column: 5,
            end_line: 10,
            end_column: 9,
            text: "test".to_string(),
            context_before: String::new(),
            context_after: String::new(),
        }],
    }];

    cache_result(&key, results, 1, 1, false);

    let cached = get_cached_result(&key);
    assert!(cached.is_some(), "should find cached result");
    let cached = cached.unwrap();
    assert_eq!(cached.results.len(), 1);
    assert_eq!(cached.results[0].file_path, "test.rs");
    assert_eq!(cached.total_matches, 1);
    assert_eq!(cached.total_files, 1);
    assert!(!cached.limit_hit);
}

#[test]
fn cache_miss_for_unknown_key() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let filters = default_filters();
    let key = SearchCacheKey::new("nonexistent_query_xyz_12345", "/no_such_repo", &filters);
    let cached = get_cached_result(&key);
    assert!(cached.is_none());
}

#[test]
fn clear_search_cache_empties_all() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let filters = default_filters();
    let key = SearchCacheKey::new("clear_test_query_unique", "/repo_clear_unique", &filters);

    cache_result(&key, vec![], 0, 0, false);
    assert!(get_cached_result(&key).is_some());

    clear_search_cache();
    assert!(get_cached_result(&key).is_none());
}

#[test]
fn cache_preserves_limit_hit_flag() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let filters = default_filters();
    let key = SearchCacheKey::new("limit_hit_test_unique", "/repo_limit", &filters);

    cache_result(&key, vec![], 5000, 100, true);

    let cached = get_cached_result(&key).unwrap();
    assert!(cached.limit_hit);
    assert_eq!(cached.total_matches, 5000);
    assert_eq!(cached.total_files, 100);

    clear_search_cache();
}

#[test]
fn keys_include_all_filters_and_clear_rejects_inflight_fill() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let filters = default_filters();
    let base = SearchCacheKey::new("complete-key", "/fixture", &filters);
    for changed in [
        SearchFilters {
            file_extensions: Some(vec!["ts".into()]),
            ..filters.clone()
        },
        SearchFilters {
            exclude_dirs: Some(vec!["vendor".into()]),
            ..filters.clone()
        },
        SearchFilters {
            include_globs: Some(vec!["src/**".into()]),
            ..filters.clone()
        },
        SearchFilters {
            exclude_globs: Some(vec!["**/*.test.ts".into()]),
            ..filters.clone()
        },
        SearchFilters {
            whole_word: Some(true),
            ..filters.clone()
        },
    ] {
        assert_ne!(
            base.hash_key(),
            SearchCacheKey::new("complete-key", "/fixture", &changed).hash_key()
        );
    }
    clear_search_cache();
    cache_result(&base, vec![], 0, 0, false);
    assert!(get_cached_result(&base).is_none());
}

#[test]
fn oversized_cache_entries_are_not_retained() {
    let _lock = CACHE_MUTEX.lock().unwrap();
    let key = SearchCacheKey::new("huge", "/fixture", &default_filters());
    cache_result(
        &key,
        vec![CodeSearchResult {
            file_path: "a".repeat(4 * 1024 * 1024),
            matches: vec![],
        }],
        0,
        1,
        false,
    );
    assert!(get_cached_result(&key).is_none());
}
