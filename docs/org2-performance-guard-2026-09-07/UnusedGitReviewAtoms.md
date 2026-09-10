# Unused Git and file-review atoms

Scope: remove the 22 confirmed unused atoms in the repo selectors/bookkeeping,
Git indicators/operation history, and file-resolution mirror. No persisted
records, backend commands, or public wire schemas are removed.

## Production paths

- GitStatusProvider -> useGitEventListeners previously subscribed to
  repo:git_operation solely to populate the unused latest-operation atom and
  a 50-entry history. Remove that subscription, setter plumbing, and atom module.
  The active repo:status_updated subscriber remains.
- ChatView -> useFileReviewSync previously called getFileResolutions on each
  enabled session load and copied its results into an unread map. Remove this
  request and mirror. Snapshot loading, workspace resolution, cancellation,
  snapshot push/reconnect handling, and Keep/Undo/Redo remain.
- Storage cleanup -> resetRepoStore still resets active state. Remove the four
  assignments to dead bookkeeping atoms, including the dynamic require callers.

## Lifecycle matrix

| Resource                           | Start / active                         | Scope change                                      | Idle / hidden                             | Close                                                |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Git operation subscription/history | No longer created                      | No longer created                                 | No retained history or operation callback | Nothing to dispose                                   |
| Git status subscription            | Existing status listener retained      | Old listeners disposed; other-repo pushes ignored | Existing push behavior retained           | Listeners disposed                                   |
| File-resolution request/map        | No longer requested or populated       | No longer requested or populated                  | No retained map                           | Nothing to dispose                                   |
| Snapshot/workspace loading         | Existing enabled-session load retained | Old snapshot results rejected                     | Existing behavior retained                | Existing cancellation and listener disposal retained |

Account, endpoint, provider-ingestion and multi-instance protocols are unchanged.
Automated tests use isolated Jotai stores and mocked transport; actual Tauri
visible/hidden CPU and RSS, offline operation, and secondary instances were not
measured. No CPU, memory, or latency improvement is claimed.

## Findings and evidence

| Area               | Verdict | Evidence                                                                   | Change or reason kept                  | Verification                                                       |
| ------------------ | ------- | -------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Background work    | fix     | Operation listener only fed dead atoms; resolution RPC only fed unread map | Remove both paths                      | Mounted hooks assert no operation listener or resolution request   |
| Memory             | fix     | Operation array and resolution map have no active readers                  | Delete retained structures and writers | Removed-symbol sweep; typecheck                                    |
| Scope/isolation    | keep    | Status callback checks current repo; snapshot load checks cancellation     | Preserve existing guards               | Other-repo push, repo switch, and delayed old-session result tests |
| Rendering/hot path | fix     | Provider subscribed to unused write action                                 | Remove setter/ref plumbing             | Existing status delivery and Keep/Undo/Redo tests                  |

## Verification

- pnpm typecheck:fast: passed.
- Targeted Git, repo, file-review, and storage-cleanup suites: 11 files / 68 tests passed.
- Removed-symbol sweep across src, tests, and scripts: zero references to all 22 atoms.
- Active Git status push and subscription disposal tested across repo switch/unmount.
- Disabled file-review load, active snapshot/workspace load, stale completion,
  listener disposal, and Keep/Undo/Redo tested through mounted production hooks.

Architecture audit: dead-code reachability includes the dynamic reset writer,
barrel exports, and test-only graph. Naming and ownership remain with their
existing domains. Existing defaults, init behavior, and resolver chains are
preserved; wire schemas and backend persistence remain unchanged.

Performance verdict: pass for the removed-resource and retained-lifecycle
invariants covered by automated tests. Real-app CPU/RSS performance is unmeasured.
