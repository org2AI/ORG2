//! Symbol search and code intelligence commands (symbols, go-to-definition, find-references).

use std::collections::HashMap;
use std::path::PathBuf;

use tracing::{debug, info, warn};

use super::super::intelligence::{TreeSitterFile, ALL_LANGUAGES};
use super::helpers::{collect_files_bounded, MAX_FILE_BYTES, MAX_SCAN_TIME};
use super::types::{CodeLocation, CodeSymbolInfo, SearchFilters, SymbolSearchResult};

#[tauri::command]
pub async fn search_symbols(
    query: String,
    repo_paths: Vec<String>,
    symbol_types: Option<Vec<String>>,
) -> Result<Vec<SymbolSearchResult>, String> {
    tokio::task::spawn_blocking(move || search_symbols_inner(query, repo_paths, symbol_types))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

fn search_symbols_inner(
    query: String,
    repo_paths: Vec<String>,
    symbol_types: Option<Vec<String>>,
) -> Result<Vec<SymbolSearchResult>, String> {
    search_symbols_at(query, repo_paths, symbol_types, std::time::Instant::now())
}

fn search_symbols_at(
    query: String,
    repo_paths: Vec<String>,
    symbol_types: Option<Vec<String>>,
    start: std::time::Instant,
) -> Result<Vec<SymbolSearchResult>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for repo_path in repo_paths {
        check_symbol_deadline(start)?;
        let root = PathBuf::from(&repo_path);
        if !root.exists() {
            continue;
        }

        let filters = SearchFilters {
            include_globs: None,
            exclude_globs: None,
            file_extensions: None,
            exclude_dirs: None,
            case_sensitive: None,
            whole_word: None,
            use_regex: None,
            max_results: None,
        };

        let collected = collect_files_bounded(
            &root,
            &filters,
            &std::sync::atomic::AtomicBool::new(false),
            start,
        )?;
        if collected.truncated {
            return Err("Symbol search incomplete: file enumeration exceeded its budget or could not read an entry".into());
        }

        for file_path in collected.files {
            check_symbol_deadline(start)?;
            let Some(ext) = file_path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            // Unsupported files have never contributed symbols; do not read
            // large logs only to discover they have no tree-sitter grammar.
            if !ALL_LANGUAGES
                .iter()
                .any(|lang| lang.file_extensions.contains(&ext))
            {
                continue;
            }
            let content = read_symbol_content(&file_path)?;
            check_symbol_deadline(start)?;
            let ts_file = TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
                .map_err(|error| {
                    format!(
                        "Symbol search incomplete: cannot parse {}: {error:?}",
                        file_path.display()
                    )
                })?;
            check_symbol_deadline(start)?;
            let scope_graph = ts_file.scope_graph().map_err(|error| {
                format!(
                    "Symbol search incomplete: cannot inspect {}: {error:?}",
                    file_path.display()
                )
            })?;
            check_symbol_deadline(start)?;
            let mut matching_symbols = Vec::new();
            for symbol in scope_graph.symbols() {
                check_symbol_deadline(start)?;
                let Some(name) = content.get(symbol.range.start.byte..symbol.range.end.byte) else {
                    continue;
                };
                if !name.to_lowercase().contains(&query_lower)
                    || symbol_types.as_ref().is_some_and(|types| {
                        !types
                            .iter()
                            .any(|kind| kind.eq_ignore_ascii_case(&symbol.kind))
                    })
                {
                    continue;
                }
                matching_symbols.push(CodeSymbolInfo {
                    name: name.into(),
                    kind: symbol.kind,
                    line: symbol.range.start.line + 1,
                    column: symbol.range.start.column + 1,
                    end_line: symbol.range.end.line + 1,
                    end_column: symbol.range.end.column + 1,
                });
            }
            if !matching_symbols.is_empty() {
                results.push(SymbolSearchResult {
                    file_path: file_path.to_string_lossy().into_owned(),
                    symbols: matching_symbols,
                });
            }
        }
    }
    check_symbol_deadline(start)?;

    let duration = start.elapsed();
    let total_symbols: usize = results.iter().map(|r| r.symbols.len()).sum();
    info!(
        symbols = total_symbols,
        files = results.len(),
        ?duration,
        "search::symbol: search complete"
    );

    Ok(results)
}

fn check_symbol_deadline(start: std::time::Instant) -> Result<(), String> {
    if start.elapsed() >= MAX_SCAN_TIME {
        Err("Symbol search incomplete: scan time budget exceeded".into())
    } else {
        Ok(())
    }
}

fn read_symbol_content(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| {
            format!(
                "Symbol search incomplete: cannot read {}: {error}",
                path.display()
            )
        })?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "Symbol search incomplete: {} exceeds the file byte budget",
            path.display()
        ));
    }
    String::from_utf8(bytes).map_err(|error| {
        format!(
            "Symbol search incomplete: {} is not UTF-8: {error}",
            path.display()
        )
    })
}

/// Extract all symbols from a file.
#[tauri::command]
pub fn get_file_symbols(file_path: String) -> Result<Vec<CodeSymbolInfo>, String> {
    let path = PathBuf::from(&file_path);

    debug!(file_path = %file_path, "search::symbol: parsing file");

    let content = std::fs::read_to_string(&path).map_err(|e| {
        warn!(file_path = %file_path, error = %e, "search::symbol: failed to read file");
        format!("Failed to read file: {}", e)
    })?;

    let ext = path.extension().and_then(|e| e.to_str()).ok_or_else(|| {
        warn!(file_path = %file_path, "search::symbol: unknown file extension");
        "Unknown file extension".to_string()
    })?;

    debug!(ext = %ext, size = content.len(), "search::symbol: file metadata");

    let ts_file =
        TreeSitterFile::try_build_from_extension(content.as_bytes(), ext).map_err(|e| {
            warn!(file_path = %file_path, error = ?e, "search::symbol: tree-sitter build failed");
            format!("Unsupported language or parse error: {:?}", e)
        })?;

    let scope_graph = ts_file.scope_graph().map_err(|e| {
        warn!(file_path = %file_path, error = ?e, "search::symbol: scope graph failed");
        format!("Failed to build scope graph: {:?}", e)
    })?;

    let symbols = scope_graph.symbols();

    let result: Vec<CodeSymbolInfo> = symbols
        .into_iter()
        .filter_map(|s| {
            let name_range = s.range.start.byte..s.range.end.byte;
            content.get(name_range).map(|name| CodeSymbolInfo {
                name: name.to_string(),
                kind: s.kind,
                line: s.range.start.line + 1,
                column: s.range.start.column + 1,
                end_line: s.range.end.line + 1,
                end_column: s.range.end.column + 1,
            })
        })
        .collect();

    debug!(symbols = result.len(), "search::symbol: symbols extracted");

    Ok(result)
}

/// Go to definition — find where a symbol is defined.
#[tauri::command]
pub fn goto_definition(
    file_path: String,
    line: usize,
    column: usize,
) -> Result<Vec<CodeLocation>, String> {
    let path = PathBuf::from(&file_path);

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Unknown file extension")?;

    let ts_file = TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
        .map_err(|_| "Unsupported language or parse error")?;

    let scope_graph = ts_file
        .scope_graph()
        .map_err(|_| "Failed to build scope graph")?;

    let target_line = line.saturating_sub(1);
    let target_column = column.saturating_sub(1);

    if let Some(node_idx) = scope_graph.node_by_position(target_line, target_column) {
        let definitions: Vec<CodeLocation> = scope_graph
            .definitions(node_idx)
            .map(|def_idx| {
                let def_node = scope_graph.get_node(def_idx).unwrap();
                let range = def_node.range();
                let text = content
                    .get(range.start.byte..range.end.byte)
                    .unwrap_or("")
                    .to_string();

                CodeLocation {
                    file_path: file_path.clone(),
                    line: range.start.line + 1,
                    column: range.start.column + 1,
                    end_line: range.end.line + 1,
                    end_column: range.end.column + 1,
                    text,
                }
            })
            .collect();

        return Ok(definitions);
    }

    Ok(vec![])
}

/// Find references — find all places where a symbol is used.
#[tauri::command]
pub fn find_references(
    file_path: String,
    line: usize,
    column: usize,
) -> Result<Vec<CodeLocation>, String> {
    let path = PathBuf::from(&file_path);

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Unknown file extension")?;

    let ts_file = TreeSitterFile::try_build_from_extension(content.as_bytes(), ext)
        .map_err(|_| "Unsupported language or parse error")?;

    let scope_graph = ts_file
        .scope_graph()
        .map_err(|_| "Failed to build scope graph")?;

    let target_line = line.saturating_sub(1);
    let target_column = column.saturating_sub(1);

    if let Some(node_idx) = scope_graph.node_by_position(target_line, target_column) {
        let definition_idx = if scope_graph.is_definition(node_idx) {
            Some(node_idx)
        } else {
            scope_graph.definitions(node_idx).next()
        };

        if let Some(def_idx) = definition_idx {
            let references: Vec<CodeLocation> = scope_graph
                .references(def_idx)
                .map(|ref_idx| {
                    let ref_node = scope_graph.get_node(ref_idx).unwrap();
                    let range = ref_node.range();
                    let text = content
                        .get(range.start.byte..range.end.byte)
                        .unwrap_or("")
                        .to_string();

                    CodeLocation {
                        file_path: file_path.clone(),
                        line: range.start.line + 1,
                        column: range.start.column + 1,
                        end_line: range.end.line + 1,
                        end_column: range.end.column + 1,
                        text,
                    }
                })
                .collect();

            return Ok(references);
        }
    }

    Ok(vec![])
}

/// Get supported languages.
#[tauri::command]
pub fn get_supported_languages() -> Vec<HashMap<String, Vec<String>>> {
    ALL_LANGUAGES
        .iter()
        .map(|lang| {
            let mut info = HashMap::new();
            info.insert(
                "language_ids".to_string(),
                lang.language_ids.iter().map(|s| s.to_string()).collect(),
            );
            info.insert(
                "extensions".to_string(),
                lang.file_extensions.iter().map(|s| s.to_string()).collect(),
            );
            info
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_utils::testing::temp_dir_with_files;

    #[tokio::test]
    async fn public_symbol_search_preserves_matches_and_reports_file_limits() {
        let (_dir, root) = temp_dir_with_files(&[("src/lib.rs", "fn bounded_needle() {}")]);
        let roots = vec![root.to_string_lossy().into_owned()];
        let found = search_symbols("bounded_needle".into(), roots.clone(), None)
            .await
            .unwrap();
        assert!(found
            .iter()
            .any(|file| file.symbols.iter().any(|s| s.name == "bounded_needle")));
        // Tree-sitter's own 500k budget and the bounded reader's 2 MiB budget
        // must both reach the public caller as errors, never empty success.
        for bytes in [500_001, MAX_FILE_BYTES as usize + 1] {
            let mut source = "fn bounded_needle() {}\n//".to_string();
            source.push_str(&" ".repeat(bytes));
            std::fs::write(root.join("src/lib.rs"), source).unwrap();
            let error = search_symbols("bounded_needle".into(), roots.clone(), None)
                .await
                .unwrap_err();
            assert!(error.contains("incomplete"), "{error}");
        }
        // Unsupported large text still contributes no symbols and is skipped.
        std::fs::rename(root.join("src/lib.rs"), root.join("src/log.txt")).unwrap();
        assert!(search_symbols("bounded_needle".into(), roots, None)
            .await
            .unwrap()
            .is_empty());
    }

    #[test]
    fn expired_symbol_search_is_an_error_even_without_results() {
        let error = search_symbols_at(
            "needle".into(),
            vec![],
            None,
            std::time::Instant::now() - MAX_SCAN_TIME,
        )
        .unwrap_err();
        assert!(error.contains("time budget"));
    }

    #[tokio::test]
    async fn public_symbol_search_rejects_truncated_enumeration() {
        let (_dir, root) = temp_dir_with_files(&[]);
        for i in 0..=super::super::helpers::MAX_FILES {
            std::fs::write(root.join(format!("{i}.rs")), "").unwrap();
        }
        let error = search_symbols(
            "needle".into(),
            vec![root.to_string_lossy().into_owned()],
            None,
        )
        .await
        .unwrap_err();
        assert!(error.contains("enumeration"), "{error}");
    }
}
