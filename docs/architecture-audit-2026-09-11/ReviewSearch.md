# Review search architecture audit

| Layer                      | Finding / evidence                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation             | Changed-file lint and full TypeScript checking pass in the isolated PR worktree.                                                                                                                              |
| 2. Ownership / duplication | Source-control review and session replay enter the shared DiffSectionList search owner. FindCard and the global coordinator remain the only search shell and shortcut owner.                                  |
| 3. Naming                  | ReviewSearchFile is the searchable read-only snapshot; ReviewSearchMatch identifies a path, side and range.                                                                                                   |
| 4. Semantic overloading    | Coordinator file scope selects the review surface. The Review/File pill independently controls the search range within that surface.                                                                          |
| 5. Defaults                | Existing DiffSectionList callers are unchanged unless review search is enabled. Missing or binary payloads are skipped; failed lazy reads surface an error.                                                   |
| 6. Domain boundaries       | Git loading stays in SourceControlMainContent. Shared review matching consumes text snapshots; CodeMirror only projects query and selection.                                                                  |
| 7. Discoverability         | Matching, worker lifecycle, lazy loading and deletion-widget navigation are separate named modules with owning-boundary tests.                                                                                |
| 8. Serialization           | A local worker receives structured-clone text snapshots and query options, returning bounded path/side/range results with a generation id. No public RPC, persistence or backend wire format changes.         |
| 9. Init parity             | Both review entry points enable the same hook. Lazy working-tree loading is injected; hydrated session payloads use the same matching function. Standalone file editors keep their existing search extension. |
| 10. Resolver symmetry      | File selection and review navigation resolve the same file path. Lazy git loading retains repo, status, staged and rename metadata through the existing resource.                                             |

74 targeted tests across 12 suites passed in the isolated PR worktree. Source inspection covers the two production entry points; native review rendering and worker bundling were not exercised. No Rust, server, authentication, provider adapter or persistence layer changed, so those runtime checks are outside this feature's scope.

## CI follow-up

The original shared hook imported CodeMirror runtime code through both the matching module and SearchQuery. Shared state now carries a dependency-free query configuration and result types; only the worker and lazy editor construct CodeMirror objects. The existing heavy-feature boundary suite now passes. The scan promise also has an explicit rejection handler, with a worker-dispatch failure regression test. Updated targeted verification: 84 tests across 13 suites and full TypeScript checking pass.
