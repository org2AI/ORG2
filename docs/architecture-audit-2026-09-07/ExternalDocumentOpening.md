# External document opening architecture audit

| Layer                  | Finding / evidence                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation          | TypeScript check and file_ops Rust tests pass; whole desktop build not run                                                                                            |
| 2 Dead code            | Removed PagesPreview, three lazy-render entry points, PagesPreviewResult, convert_pages_to_html, find_png_in_dir, command registration and file_ops base64 dependency |
| 3 Naming               | Pages has no dedicated PreviewType; externally opened handlers retain app names                                                                                       |
| 4 Semantic overloading | Binary classification means unsupported in-app content; external opening remains a separate capability                                                                |
| 5 Default branches     | Pages reaches the binary placeholder via real extension detection, with no code/preview toggle                                                                        |
| 6 Domain boundaries    | OS handler discovery remains in the existing service; artwork mapping only decorates returned handlers                                                                |
| 7 Discoverability      | No legacy Pages renderer or conversion route remains in source; shared PDF/Office mechanisms retained for their real consumers                                        |
| 8 Wire protocol        | Removed unused convert_pages_to_html IPC command and its sole caller together; desktop frontend/backend must ship together; revert restores both                      |
| 9 Init parity          | Cold routing and cached remount/tab restoration covered; normal editor and both diff surfaces no longer import the Pages renderer                                     |
| 10 Resolver symmetry   | Canonical binary resolver handles .pages and .PAGES; native/TS external-document allowlists retain Pages intentionally                                                |

Authoritative state is the file-content cache plus current loaded path. Cached binary hydration skipped the loaded-path assignment, so the derived view exposed an empty editor after switching tabs. The cached branch now marks its path loaded. Hook regression tests exercise first load, repeated tab switches and remounts for Numbers, Pages and ZIP. No persisted data changes or historical cleanup are needed.
