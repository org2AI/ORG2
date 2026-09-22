# Spotlight second-pass audit

Status: this is a historical second-pass audit. The subsequent UI consolidation implements clone busy-state propagation, duplicate-submit protection and removal of the unreachable combined clone form. Other findings remain follow-up work; see the cleanup/component reports for delivered scope.

2026-09-15, after the approved first cleanup. Audit only: no production changes in this pass. Acceptance criteria: identify additional reachable defects or concrete duplication; trace producing boundaries and adjacent consumers; reproduce races where feasible; distinguish source evidence from native/runtime verification.

## Findings, in suggested order

### 1. P2 — File search accepts obsolete responses

`src/scaffold/GlobalSpotlight/palettes/EditorPalette/hooks/useFileMode.ts:94`, `:166`, `:172`, `:185`.

The effect cancels the debounce timeout, but does not invalidate a request once it starts. Success, error and finally all commit without checking the query, root set or active lifetime. Query A starts, B starts, B resolves, then A resolves: the list displays A under B's query. Clearing the query or closing also does not prevent late writes.

**Reproduced:** real React hook with deferred native-search promises; rendered `b.ts`, then changed to `a.ts` when A resolved last. Fix at the result-producing effect with a generation/lifetime guard covering every state write, including loading and errors. Keep debounce and native prewarm behavior separate from result validity. Cover query clear, root change and close as well as A/B ordering.

### 2. P2 — Symbol rows belong to the previous file; close does not invalidate an active request

`src/scaffold/GlobalSpotlight/palettes/EditorPalette/hooks/useSymbolMode.ts:120`, `:142`, `:169`, `:174`, `:255`; selection at `hooks/useEditorPalette.ts:128`.

Two problems share one ownership boundary:

- Changing currentFile A → B retains A's symbols while B loads. `symbolState.fetchedPath` is written but never checked. Those rows remain actionable; selecting A's symbol sends its line number to the current editor, now B.
- Cleanup cancels pending debounce only. An already-started request can resolve after disabling, repopulate `fetchedPathRef`, and make reopening the same file skip its promised fresh fetch.

**Reproduced both:** A's row remained actionable during B's pending request and selected line 8; a closed response populated the cache and reopening performed no second fetch. Store results with their source scope and invalidate in-flight generation on every cleanup. Reject mismatched results at the hook's canonical projection, not with ad hoc row-label filters. Placeholder rows also currently lack disabled metadata despite having no action; make their non-interactive semantics explicit during this cleanup.

### 3. P2 — Local branch cache identity omits checkout path, and empty responses do not clear rows

`src/scaffold/GlobalSpotlight/palettes/BranchPalette/useBranchFetch.ts:49`, `:169`, `:183`, `:235`; `src/features/SessionCreator/components/useWorktreeSourceData.ts:194`, `:383`; `src/api/http/git/branches.ts:33`.

The API explicitly keys in-flight requests by repo ID **and checkout path**. The frontend branch cache, loading set and fetched marker use only repo ID. This loses the scope distinction before and after transport. SessionInfoLine passes `selectedWorktreePath ?? repoPath` into both dropdown and palette (`src/features/SessionCreator/components/SessionInfoLine.tsx:125,298,310`), so this is a production entry path.

**Reproduced:** changing `/main` to `/worktree` with the same repo ID and a fresh cache made no API call and continued showing the main-checkout result. Deferred responses for different checkout paths also overwrote the same cache slot. Related readers/writers in SessionCreator share the same repo-only identity and must migrate together.

Separately, cache synchronization uses `cached.branches.length > 0`. A successful authoritative empty branch response updates the cache to `[]` but leaves the previous nonempty local list visible. **Reproduced** cache empty / rendered `old` divergence.

Use one typed scoped key for all cache/loading/read/write/invalidation owners, and treat successful empty results as valid data. Prefer deriving the displayed list from the scoped store to mirroring it in independent state. Preserve the API's existing equivalent-request deduplication: the audit confirmed that layer already works, so two hook invocations alone are not evidence of two network requests. Mutation invalidation must also reach the in-flight request owner rather than merely deleting completed cache data.

### 4. P2 — Clone forms discard their real busy state

`src/scaffold/GlobalSpotlight/hooks/forms/useCloneForm.ts:93`, `:224`; `src/scaffold/GlobalSpotlight/views/SpotlightModalView.tsx:127`, `:155`.

The hook writes loading with `const [, setLoading]`, never returns it, and has no in-flight guard. Both live clone forms receive `loading={false}`. Their existing loading/disable behavior cannot activate, so another submit can enter the clone handler while the first attempt is pending. The outer flow's `isLoading` includes GitHub discovery, not cloning.

Expose clone busy state, pass it to both forms and the flow, and guard duplicate submission at the clone operation boundary. Do not delete this apparently unread state without restoring the behavior it was meant to provide. This is source-confirmed; no real clone was issued or filesystem destination modified.

### 5. P2 — Reachable My GitHub clone flow uses a permanently empty provider

`src/scaffold/GlobalSpotlight/hooks/forms/useAddWorkingDirectoryFlow.ts:209`; `src/scaffold/GlobalSpotlight/hooks/forms/useCloneForm.ts:96`; `src/hooks/git/useGitHubConnections.ts:81`.

The add-directory menu advertises clone-from-My-GitHub and routes to its form. The only repository source is an explicit OSS stub: `connections: []`, empty caches and no-op fetches. Opening Connections cannot populate this hook. The capability is reachable but cannot list repositories in this build.

Either wire the form to the current Git connection/repository service, or capability-gate/retire this specific entry and retain URL clone. Do not preserve a success-shaped empty data provider as if it were a transient loading state. GitHub branch options also consume this stub; evaluate their production entry availability in the same capability sweep. No claim of live GitHub authentication/network testing.

### 6. P2 — Refresh animation has competing timers and no teardown

`src/scaffold/GlobalSpotlight/shared/refreshSpin.ts:58`, `:65`; consumers: `palettes/BranchPalette/useBranchPalette.ts:99`, `palettes/BranchPalette/index.tsx:115`, `palettes/BranchPalette/BranchPullRequestPicker.tsx:170`.

Each click creates an independent eventual stop timer. Refresh remains clickable during the spin. A previous timer can set spinning=false while a later refresh is still pending, and timers are not disposed on unmount. **Reproduced:** fast first refresh, pending second refresh at 450ms, spin stopped at the first 900ms deadline.

Use one owned deadline/timer plus pending count or generation semantics; explicitly define behavior for overlapping refreshes and clear on teardown. Do not silently turn request errors into apparent success at this generic visual wrapper. The remaining shell refocus timeout at `shell/SpotlightShellChrome.tsx:102` is another ownership sweep candidate; it queries a live ref so it normally no-ops after unmount, but it is not canceled/coalesced. No native focus incident was reproduced there.

### 7. P3 — More dead code survives through render/type references

| Location                                                                 | Evidence                                                                                                                                                        | Cleanup                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palettes/EditorPalette/index.tsx:96,151`                                | `showModePill` is true for every non-file mode; `mode !== "file" && !showModePill` is impossible. ModeIndicator has no other consumer                           | Delete the condition, component and trailing-slot plumbing                                                                                         |
| `views/SpotlightModalView.tsx:73`; `forms/CloneRepo/CloneRepoForm.tsx:1` | Combined `add-workspace-clone` stage has no production writer. Initial-stage union permits only split URL/GitHub stages; current menu writes those split stages | Delete the 357-line combined form, its render branch/export, dead stage labels and obsolete sub-tab machinery after tracing remaining fetch gating |
| `components/SpotlightSearchBar.tsx:66`                                   | `isLoading` is only destructured as `_isLoading`; real list loading lives in PaletteBody                                                                        | Remove misleading prop and callers, preserving list loading                                                                                        |
| `hooks/forms/useAddWorkingDirectoryFlow.ts:103`                          | `onClose` is destructured as `_onClose`; behavior uses `onModalClose` and internal form callbacks                                                               | Remove the ignored argument and adjust callers                                                                                                     |

The combined clone form is dead despite being imported and rendered in a switch: its route is unreachable. Conversely, split URL/GitHub forms are live and are not deletion candidates solely because they duplicate UI.

### 8. P3 — Workspace activation and name resolution are copied

`src/scaffold/GlobalSpotlight/hooks/data/useWorkspaceSwitch.ts:23,31,102` and `src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/useWorkingDirectoryPaletteWorkspaces.tsx:73,81,133`.

Both implement the same file-URI normalization, repo-ID/path/name fallback resolver, folder projection, UUID assignment, active workspace update and close callback. The management hook differs in edit/delete presentation, not activation semantics.

Share the activation operation and resolver, preserving per-surface filtering/manage behavior. Add parity coverage that activates the same workspace from dropdown and Spotlight. This is confirmed duplication, not a claim of an existing activation bug.

### 9. P3 — Clone destination controls duplicate presentation and callback plumbing

`src/scaffold/GlobalSpotlight/forms/CloneRepo/CloneRepoUrlForm.tsx:110` and `CloneRepoGitHubForm.tsx:196`; obsolete third copy in `CloneRepoForm.tsx:254`.

The same destination Input, folder picker, preview and choose-path callbacks are maintained independently. Ordinary action buttons restyle height/width, border, surface and hover at each site rather than expressing the surface through shared Button props. Parent view callbacks set localPath, then the child sets it again for the same chosen path.

After deleting the unreachable combined form, sweep the two live variants into a shared destination field with one callback contract and shared Button presentation. Preserve intentional editable-vs-picker-only behavior where a live caller needs it. See [UI audit](../frontend-ui-audit-2026-09-15/SpotlightSecondPass.md).

## Ten-layer coverage

| Layer                   | Evidence / limit                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilation             | Prior cleanup's full fast typecheck and scoped linters passed; no production code changed in this pass. Focused current-tree probes compiled/executed; full suite not rerun for documentation-only audit |
| Dead code / duplication | Traced clone route writers and initial-stage union; impossible ModeIndicator condition; paired workspace/destination implementations                                                                     |
| Naming                  | Distinguish clone busy from repository-discovery loading; identify permanently empty provider vs transient empty result                                                                                  |
| Semantic overloading    | `repoId` is repository identity, not checkout identity; `isLoadingRepos` excludes clone mutation state                                                                                                   |
| Defaults                | Empty cache ignored; unsupported/empty symbol rows remain selectable; provider returns permanent empty success-shaped values                                                                             |
| Domain leakage          | Symbol hook imports Outline UI icon configuration intentionally for common glyphs; no new cross-domain leak asserted                                                                                     |
| New-developer clarity   | Dead combined form, ignored props and pretend clone loading are misleading API surfaces                                                                                                                  |
| Wire                    | Inspected actual API request builder and ran its two deduplication tests; repo_path is serialized and part of transport key. No network payload capture or Rust execution; no wire defect claimed        |
| Init parity             | Dropdown and Spotlight share branch hook but collide across path scope; direct initial clone stages and menu agree on split forms; duplicate workspace activation currently matches                      |
| Resolver symmetry       | Compared scoped API key with cache/loading/fetched keys and all shared branch cache consumers; copied workspace fallback chains currently match                                                          |

## Verification and boundaries

Ran `pnpm test src/scaffold/GlobalSpotlight/spotlightSecondPassProbe.test.ts src/api/http/git/branches.test.ts`: **2 files, 9 tests passed**. Seven temporary probes asserted the observed defective behavior; two existing API tests verified correct equivalent-request deduplication and distinct-path isolation. Passing these diagnostic probes proves reproduction, not product correctness. Temporary probe source was removed from the repository after execution and retained locally at `/tmp/spotlightSecondPassProbe.test.ts`; output is `/tmp/spotlight-second-probes.txt`.

No production source edits, database remediation, real clone, real network request, desktop control, native focus/visual measurement, Rust checks or CPU/RSS profiling. Findings are source/React-hook evidence. Existing first-cleanup changes and unrelated staged/unstaged work were preserved.
