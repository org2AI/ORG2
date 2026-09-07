# Document application opening architecture review

Scope: document preview header → DocumentOpenMenu → Tauri commands → system_services::document_apps → NSWorkspace / OS opener.

Acceptance: no eager OS query, no polling, bounded cache and concurrent requests, exact local file associations, source-side local path validation, shared header integration, no document writes or persistence changes.

| Layer                     | Result                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Compilation             | Frontend typecheck and targeted lint passed in the isolated PR worktree; Rust Clippy and 3 tests passed, including native macOS PDF handler discovery                    |
| 2 Ownership/deduplication | One header action for the preview branches; one query cache owns repeated/concurrent discovery                                                                           |
| 3 Naming                  | DocumentApplication means an installed OS file handler, distinct from app-level workstations                                                                             |
| 4 Semantic overload       | File path and application bundle path are separate named fields                                                                                                          |
| 5 Defaults                | Default-app opening always available; named handler discovery is macOS-only; other platforms return an empty list and use the OS default opener                          |
| 6 Boundaries              | Native discovery and file validation remain in the existing OS services crate; no upper-layer imports                                                                    |
| 7 Readability             | No startup registration hook, watcher or timer; ordinary menu expansion owns loading                                                                                     |
| 8 Wire                    | Serialization test asserts path/name/isDefault; paths passed as structured IPC/process arguments, never interpolated into shell code; no icons or document contents sent |
| 9 Entry points            | Both commands registered in handler_list.inc; both validate an existing absolute file on a blocking worker; UI forwards selectedFile, not the breadcrumb path            |
| 10 Resolution             | Default and compatible applications both come from NSWorkspace for the same exact file URL; cache keys are full paths rather than just extensions                        |

No schema, dependency, lockfile, migration, or account data changes. No network/provider/session initialization paths apply. System association changes become visible on the next menu expansion after the 60-second cache TTL. Removed applications fail at launch validation; the error is shown without an automatic retry loop. Unsaved document edits must be saved/discarded first. External editor changes use the existing preview reload behavior.

Verification commands and remaining runtime limitations are recorded in `docs/org2-performance-guard-2026-09-07/DocumentOpenMenu.md`.
