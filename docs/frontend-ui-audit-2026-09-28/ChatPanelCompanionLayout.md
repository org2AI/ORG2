# ChatPanelCompanionLayout UI audit

| Line                               | Element                      | Verdict          | Reason                                                                                                                                                                                 | Suggested change |
| ---------------------------------- | ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ChatPanelCompanionLayout.tsx:60`  | Companion header and actions | keep with reason | Reuses PanelHeader, PANEL_HEADER_TOKENS, shared Button, existing translated title/close/move labels; no native action elements or custom clickable substitutes added                   | None             |
| `ChatPanelCompanionLayout.tsx:48`  | Resizable divider            | keep with reason | Reuses VerticalResizeHandle and useColumnResize, including existing drag cancellation/unmount cleanup                                                                                  | None             |
| `ChatPanelCompanionLayout.tsx:25`  | Reading width constraints    | keep with reason | Feature-owned initial/min/max reading widths; a 50% CSS cap reserves at least half the available pane for chat even in narrow layouts                                                  | None             |
| `ChatPanelCompanionLayout.tsx:135` | Chat/companion composition   | keep with reason | Stable chat subtree; companion replaces only the summary rail and unmounts on close or owner change                                                                                    | None             |
| `SessionSourcesContent.tsx:10`     | Shared source data container | keep with reason | Both the companion and Station renderer consume the same source hook, shared-file scope and SessionSourcesView; category disclosures, navigation, retry and theme tokens remain shared | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

## State and architecture

The owning state is one transient per-store `ChatPanelCompanion`, identified by type, session ID and owner tab ID. Opening is idempotent and validates the active conversation at the write boundary. The host rejects stale scope immediately, then clears the slot on navigation/unmount. No new persistent setting, tab schema, API, database or wire protocol is introduced. Existing Station sources tabs remain compatible; opening there is explicit.

Architecture review covered state ownership, type/control flow, default destination, content reuse, entry-point parity and session-scope resolution. Backend/schema/wire and migration layers are unchanged. This is not a general-purpose tab framework: the supported companion type is currently `session-sources`.

The data path is View all → openSessionSources → openChatPanelSourcesAtom → ChatPanelShell/ChatPanelCompanionLayout → shared SessionSourcesContent → existing source history reader. Loading, empty, error/retry and same-session refresh behavior remain owned by useSessionSourcesState and SessionSourcesView. Closing releases the content; reopening is a fresh view, not a persisted cache. Category state is preserved through same-session refresh but resets after closing.

## Verification

- `pnpm test:app src/engines/ChatPanel/ChatPanelCompanionLayout.test.ts src/engines/ChatPanel/sessionSources/openSessionSources.test.ts src/engines/ChatPanel/sessionSources/useSessionSources.test.ts src/features/SessionSources/SessionSourcesView.test.ts src/modules/WorkStation/TabContent/renderers/sessionSources.test.ts src/modules/WorkStation/TabContent/renderers/sessionSources.activities.test.ts` — 41 tests passed in 6 files
- `pnpm typecheck:fast` — passed after adding the concrete HTMLDivElement ref type in the new test
- ESLint on all changed/new production and test files — passed
- Changed production controls inspected: only shared Button actions; no raw button/input or clickable element substitutes introduced
- Native visual automation cannot select the unbundled ORG2 Dev executable; browser-mode app cannot access desktop session IPC. Isolated real-component rendering is used for layout evidence, not claimed as native/data integration verification

## Performance guard

| Area               | Verdict | Evidence                                                                                     | Change or reason kept                                                                                                | Verification                                                             |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Background work    | keep    | Existing useSessionSourcesState history reads and visibility listener                        | Only mounted source content owns reads; no new polling; existing in-flight sharing and stale-response guard retained | Existing hook visibility/stale/error tests plus companion disposal tests |
| Memory             | keep    | One nullable atom slot and one mounted companion                                             | No per-session map or app-lifetime result cache; close/navigation/unmount releases content                           | Composition tests assert disposal and slot clearing                      |
| Scope/isolation    | keep    | Owner tab ID plus session ID at write and render boundaries                                  | Stale open is rejected; scope changes remove old content before effect cleanup                                       | Stale-action and session/tab-switch tests                                |
| Rendering/hot path | keep    | Chat subtree retains position; source content lazy loads; shared resize hook uses DOM writes | Open/repeat/close preserves the same input node and unsent draft                                                     | Parent shell composition test                                            |

Performance verdict: **blocked** for native runtime measurement only. Unit ownership/lifecycle checks passed; native idle CPU/RSS, native window resizing and cloud-session manual validation were not measured. No runtime performance improvement is claimed.

### Rendered follow-up

- Real ChatPanelCompanionLayout, shared header/buttons, resizing, SessionSourcesContent and SessionSourcesView rendered in an isolated browser fixture. Only desktop state/API/navigation dependencies and source payloads were fixtures.
- Verified View all opens alongside the chat draft, repeated open retains the view, category collapse works, and close restores the summary. Inspected dark/narrow and light/wide rendering.
- At 1200px, source content measured 420px and chat 779px. Dragging the divider 80px left grew sources to 500px.
- At 600px, sources were capped at 300px. Found that the shared resize hook initially used the uncapped stored width; changed drag initialization to read the actual layout width. Verified dragging 20px right immediately shrinks the pane to 280px. The hook still uses its configured width when no measured width is available.
- `pnpm test:app src/scaffold/Resize/hooks/useColumnResize.test.ts src/engines/ChatPanel/ChatPanelCompanionLayout.test.ts` — 5 passed, including the new constrained-width regression (42 distinct relevant tests passed across both runs).
- Typecheck and lint passed after the resize change; `git diff --check` for the tracked files touched by this change passed. Native runtime measurement remains unverified as stated above.

### Floating chrome overlap regression

The initial isolated preview used an in-flow sample header, so it missed the live shell's absolute overlay chrome. The source companion started at y=0 and its header/actions overlapped the global conversation toolbar. ChatPanel now passes its canonical chromeTopInsetPx through ChatPanelShell to the companion and its resize divider, just as the transcript and summary rail already consume it. No independent header-height constants were added.

- Regression coverage renders real ChatPanelShell and ChatPanelChrome, transitions between collapsed overlay (44px), expanded overlay (80px), and in-flow (0px), and asserts that the source pane, divider and unchanged chat/source mounts follow the shared inset.
- `pnpm test:app src/engines/ChatPanel/ChatPanelCompanionLayout.test.ts src/engines/ChatPanel/header/ChatPanelChrome.test.ts src/engines/ChatPanel/header/chatPanelHeaderLayout.test.ts` — 28 tests passed in 3 files.
- `pnpm typecheck:fast` and ESLint on the four changed production/test files passed; tracked-file diff whitespace checks passed.
- Rendered real ChatPanelChrome and its published-header slot component with the companion: light 1280px collapsed toolbar and dark 600px expanded toolbar. Source header/actions appear below the global toolbar in both. Collapsed companion top measured 44px; narrow expanded screenshot confirms separation and 50% width cap. Closing sources works and retains the chat draft.
- Preview fixtures replace desktop state/platform dependencies, source payloads and navigation; this is rendered component evidence, not native app verification. Native automation limitation described above still applies.

### Isolated PR branch verification

After integrating latest `origin/develop` without rewriting reviewed history:

- `pnpm test src/features/SessionSources src/engines/ChatPanel/sessionSources src/engines/ChatPanel/ChatPanelCompanionLayout.test.ts src/engines/ChatPanel/header/ChatPanelChrome.test.ts src/engines/ChatPanel/header/chatPanelHeaderLayout.test.ts src/scaffold/Resize/hooks/useColumnResize.test.ts src/modules/WorkStation/TabContent/renderers/sessionSources.test.ts src/modules/WorkStation/TabContent/renderers/sessionSources.activities.test.ts` — 98 tests passed in 15 files.
- `pnpm typecheck:fast` — passed on the isolated PR branch.
- ESLint on the 14 changed/new TypeScript files — passed.
- `pnpm check:test-placement` — passed, 636 directories.
- `git diff --cached --check` — passed; staged scope and private-path/debug-output inspection found no unrelated additions.
