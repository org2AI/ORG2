use super::text_search::{search_code_fast_inner, search_code_fast_inner_with_handlers};
use super::types::SearchFilters;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

static SEARCH_TEST_LOCK: Mutex<()> = Mutex::new(());
struct TempSearchDir {
    _guard: std::sync::MutexGuard<'static, ()>,
    path: PathBuf,
}

impl TempSearchDir {
    fn new(name: &str) -> Self {
        let guard = SEARCH_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "orgii-search-test-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("test temp directory should be created");
        Self {
            path,
            _guard: guard,
        }
    }

    fn path_str(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    fn write_file(&self, relative_path: &str, content: &str) {
        let path = self.path.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("test file parent should be created");
        }
        fs::write(path, content).expect("test file should be written");
    }
}

impl Drop for TempSearchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn test_filters(max_results: usize) -> SearchFilters {
    SearchFilters {
        include_globs: None,
        exclude_globs: None,
        file_extensions: Some(vec!["rs".to_string()]),
        exclude_dirs: None,
        case_sensitive: Some(false),
        whole_word: Some(false),
        use_regex: Some(false),
        max_results: Some(max_results),
    }
}

fn total_result_matches(results: &[super::types::CodeSearchResult]) -> usize {
    results.iter().map(|result| result.matches.len()).sum()
}

#[test]
fn fast_search_inner_finds_literal_case_insensitive_matches() {
    let temp_dir = TempSearchDir::new("literal");
    temp_dir.write_file("src/lib.rs", "AlphaNeedle\nbeta needle\n");
    temp_dir.write_file("src/ignored.txt", "needle\n");

    let outcome = search_code_fast_inner("needle", &temp_dir.path_str(), test_filters(10), None)
        .expect("fast search should succeed");

    assert_eq!(outcome.total_matches, 2);
    assert_eq!(outcome.total_files, 1);
    assert_eq!(total_result_matches(&outcome.results), 2);
    assert!(!outcome.limit_hit);
    assert!(!outcome.cancelled);

    let result = outcome
        .results
        .iter()
        .find(|result| Path::new(&result.file_path).ends_with("src/lib.rs"))
        .expect("Rust file should have matches");
    assert_eq!(result.matches[0].line, 1);
    assert_eq!(result.matches[0].text, "Needle");
    assert_eq!(result.matches[1].line, 2);
    assert_eq!(result.matches[1].text, "needle");
}

#[test]
fn fast_search_inner_respects_max_results() {
    let temp_dir = TempSearchDir::new("limit");
    temp_dir.write_file("src/lib.rs", "needle one\nneedle two\nneedle three\n");

    let outcome = search_code_fast_inner("needle", &temp_dir.path_str(), test_filters(2), None)
        .expect("fast search should succeed");

    assert_eq!(outcome.total_matches, 2);
    assert_eq!(total_result_matches(&outcome.results), 2);
    assert!(outcome.limit_hit);
}

#[test]
fn fast_search_inner_handlers_receive_file_count_and_progress() {
    let temp_dir = TempSearchDir::new("callbacks");
    temp_dir.write_file("src/lib.rs", "needle\n");
    temp_dir.write_file("src/main.rs", "needle\n");

    let file_count_seen = Arc::new(Mutex::new(None));
    let progress_seen = Arc::new(Mutex::new(Vec::new()));

    let file_count_for_callback = Arc::clone(&file_count_seen);
    let progress_for_callback = Arc::clone(&progress_seen);
    let outcome = search_code_fast_inner_with_handlers(
        "needle",
        &temp_dir.path_str(),
        test_filters(10),
        None,
        move |total_files| {
            *file_count_for_callback.lock().unwrap() = Some(total_files);
        },
        move |_result, total_matches, total_files| {
            progress_for_callback
                .lock()
                .unwrap()
                .push((total_matches, total_files));
        },
    )
    .expect("fast search should succeed");

    assert_eq!(*file_count_seen.lock().unwrap(), Some(2));
    assert_eq!(outcome.total_matches, 2);
    assert_eq!(outcome.total_files, 2);

    let progress = progress_seen.lock().unwrap();
    assert_eq!(progress.len(), 2);
    assert!(progress.iter().all(|(total_matches, total_files)| {
        (1..=outcome.total_matches).contains(total_matches)
            && (1..=outcome.total_files).contains(total_files)
    }));
    assert!(progress
        .iter()
        .any(|(total_matches, total_files)| { *total_matches == 2 && *total_files == 2 }));
}

#[test]
fn filters_apply_whole_words_recursive_globs_and_utf16_columns() {
    let dir = TempSearchDir::new("filter-contract");
    dir.write_file("src/deep/nested/a.ts", "中😀 cat scatter catapult cat\n");
    dir.write_file("src/deep/nested/a.test.ts", "cat\n");
    dir.write_file("src/other.rs", "cat\n");
    let mut filters = test_filters(100);
    filters.file_extensions = None;
    filters.include_globs = Some(vec!["src/**/*.ts".into()]);
    filters.exclude_globs = Some(vec!["**/*.test.ts".into()]);
    filters.whole_word = Some(true);
    let outcome = search_code_fast_inner("cat", &dir.path_str(), filters, None).unwrap();
    assert_eq!(outcome.total_files, 1);
    assert_eq!(outcome.total_matches, 2);
    assert_eq!(outcome.results[0].matches[0].column, 5);
    assert_eq!(outcome.results[0].matches[1].column, 26);
}

#[test]
fn cache_revalidates_filter_scope_and_external_edit_create_delete() {
    let dir = TempSearchDir::new("freshness");
    dir.write_file("a.rs", "needle\n");
    let first = search_code_fast_inner("needle", &dir.path_str(), test_filters(100), None).unwrap();
    assert_eq!(first.total_matches, 1);
    dir.write_file("b.rs", "needle\nneedle\n");
    dir.write_file("a.rs", "changed\n");
    let second =
        search_code_fast_inner("needle", &dir.path_str(), test_filters(100), None).unwrap();
    assert_eq!(second.total_matches, 2);
    fs::remove_file(dir.path.join("b.rs")).unwrap();
    assert_eq!(
        search_code_fast_inner("needle", &dir.path_str(), test_filters(100), None)
            .unwrap()
            .total_matches,
        0
    );
    dir.write_file("c.ts", "needle\n");
    let filters = SearchFilters {
        file_extensions: Some(vec!["ts".into()]),
        ..test_filters(100)
    };
    assert_eq!(
        search_code_fast_inner("needle", &dir.path_str(), filters, None)
            .unwrap()
            .total_matches,
        1
    );
}

#[test]
fn long_line_results_have_a_real_serialized_byte_budget() {
    let dir = TempSearchDir::new("payload");
    dir.write_file(
        "deep/nested/result.rs",
        &format!("{}{}\n", "中😀 needle ".repeat(2000), "x".repeat(32_000)),
    );
    let outcome =
        search_code_fast_inner("needle", &dir.path_str(), test_filters(20000), None).unwrap();
    let bytes = serde_json::to_vec(&outcome.results).unwrap().len();
    assert!(
        bytes <= super::text_search::MAX_RESULT_BYTES,
        "actual wire bytes: {bytes}"
    );
    assert!(outcome.results.iter().flat_map(|r| &r.matches).all(|m| m
        .context_before
        .chars()
        .count()
        <= 160
        && m.context_after.chars().count() <= 160));
    assert!(outcome.budget_exhausted);
}

#[test]
fn precancel_stops_before_enumeration_and_midstream_cancel_stops_other_files() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = TempSearchDir::new("cancel");
    dir.write_file("a.rs", "needle\n");
    dir.write_file("b.rs", "needle\n");
    let cancelled = Arc::new(AtomicBool::new(true));
    let outcome = search_code_fast_inner(
        "needle",
        &dir.path_str(),
        test_filters(100),
        Some(cancelled.clone()),
    )
    .unwrap();
    assert!(outcome.cancelled);
    assert_eq!(outcome.total_files_searched, 0);
    cancelled.store(false, Ordering::Relaxed);
    let cancel_on_result = cancelled.clone();
    let outcome = search_code_fast_inner_with_handlers(
        "needle",
        &dir.path_str(),
        test_filters(100),
        Some(cancelled),
        |_| {},
        move |_, _, _| {
            cancel_on_result.store(true, Ordering::Relaxed);
        },
    )
    .unwrap();
    assert!(outcome.cancelled);
    assert_eq!(outcome.total_files, 1);
}

#[test]
fn oversized_files_are_explicitly_partial_and_invalid_globs_can_retry() {
    let dir = TempSearchDir::new("budget");
    dir.write_file(
        "large.rs",
        &"x".repeat(super::helpers::MAX_FILE_BYTES as usize + 1),
    );
    let outcome = search_code_fast_inner("x", &dir.path_str(), test_filters(100), None).unwrap();
    assert!(outcome.budget_exhausted);
    assert!(outcome.results.is_empty());
    let invalid = SearchFilters {
        include_globs: Some(vec!["[".into()]),
        ..test_filters(100)
    };
    assert!(search_code_fast_inner("x", &dir.path_str(), invalid, None).is_err());
    dir.write_file("small.rs", "needle\n");
    assert_eq!(
        search_code_fast_inner("needle", &dir.path_str(), test_filters(100), None)
            .unwrap()
            .total_matches,
        1
    );
}

#[test]
fn cancel_before_registration_is_remembered_and_duplicate_ids_cannot_replace_owner() {
    use std::sync::atomic::Ordering;
    super::helpers::cancel_search("fixture-pre-cancel".into());
    let flag = super::helpers::register_search("fixture-pre-cancel").unwrap();
    assert!(flag.load(Ordering::Relaxed));
    assert!(super::helpers::register_search("fixture-pre-cancel").is_err());
    super::helpers::unregister_search("fixture-pre-cancel");
    let retry = super::helpers::register_search("fixture-pre-cancel").unwrap();
    assert!(!retry.load(Ordering::Relaxed));
    super::helpers::unregister_search("fixture-pre-cancel");
}

#[tokio::test]
async fn batch_command_honors_cancel_before_registration_and_releases_for_retry() {
    let dir = TempSearchDir::new("batch-cancel");
    dir.write_file("a.rs", "needle");
    let id = "fixture-batch-owner";
    super::helpers::cancel_search(id.into());
    let error = super::text_search::search_code_regex(
        "needle".into(),
        vec![dir.path_str()],
        Some(test_filters(10)),
        Some(id.into()),
        None,
    )
    .await
    .unwrap_err();
    assert!(error.contains("cancelled"));
    let results = super::text_search::search_code_regex(
        "needle".into(),
        vec![dir.path_str()],
        Some(test_filters(10)),
        Some(id.into()),
        None,
    )
    .await
    .unwrap();
    assert_eq!(total_result_matches(&results), 1);
}

#[test]
fn four_independent_workers_progress_and_capacity_is_released_after_completion() {
    use std::sync::Barrier;
    let dir = TempSearchDir::new("workers");
    dir.write_file("a.rs", "needle");
    let ready = Arc::new(Barrier::new(5));
    let release = Arc::new(Barrier::new(5));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let path = dir.path_str();
            let ready = ready.clone();
            let release = release.clone();
            std::thread::spawn(move || {
                search_code_fast_inner_with_handlers(
                    "needle",
                    &path,
                    test_filters(10),
                    None,
                    |_| {
                        ready.wait();
                        release.wait();
                    },
                    |_, _, _| {},
                )
            })
        })
        .collect();
    ready.wait();
    let overflow = search_code_fast_inner("needle", &dir.path_str(), test_filters(10), None);
    release.wait();
    for handle in handles {
        assert_eq!(handle.join().unwrap().unwrap().total_matches, 1);
    }
    assert!(overflow.unwrap_err().contains("busy"));
    assert_eq!(
        search_code_fast_inner("needle", &dir.path_str(), test_filters(10), None)
            .unwrap()
            .total_matches,
        1
    );
}

#[tokio::test]
async fn open_file_batch_uses_repository_relative_glob_scope() {
    let dir = TempSearchDir::new("open-file-glob");
    dir.write_file("src/a.rs", "needle");
    dir.write_file("tests/a.rs", "needle");
    let paths = vec![
        dir.path.join("src/a.rs").to_string_lossy().into_owned(),
        dir.path.join("tests/a.rs").to_string_lossy().into_owned(),
    ];
    let filters = SearchFilters {
        include_globs: Some(vec!["src/**/*.rs".into()]),
        ..test_filters(10)
    };
    let results = super::text_search::search_code_regex(
        "needle".into(),
        paths,
        Some(filters),
        None,
        Some(dir.path_str()),
    )
    .await
    .unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].file_path.ends_with("src/a.rs"));
}
