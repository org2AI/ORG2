# Session creator draft content synchronization

## Finding and fix

The running Tauri creator displayed the user's prompt while its Send button was
disabled. Triggering a content change enabled the button. Clicking Send then
reached the existing short-input confirmation; no provider turn was submitted.

The producing boundary is `useDraftManagement`'s no-saved-draft load branch.
It intentionally preserves the live editor, but previously reset `editorContent`
to an empty string. That state drives launch validation and the debounced draft
writer. A rendered regression with the real ComposerInput reproduces visible
text with a disabled submission control before the fix.

The branch now reads the live editor's text, keeping validation and persistence
aligned with the content it preserves. Saved-draft restoration, model selection,
API launch behavior and storage format are unchanged.

The authoritative stored draft is `orgii:sessionCreatorDrafts` in localStorage.
After restoring the user's exact original text, a read-only inspection confirmed
the active draft's `editorContent` and structured snapshot contain that text.
No historical drafts were deleted. The installed app was not rebuilt; its current
draft was recovered through normal editor input.

## Lifecycle verification

| Area               | Verdict | Evidence                                                          | Change or reason kept                                  | Verification                                                                         |
| ------------------ | ------- | ----------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Background work    | keep    | Existing 500 ms debounced save and bounded restore timers         | No new timer, listener, retry or polling               | Idle produces no further store writes; unmount cancels pending save                  |
| Memory             | keep    | Existing component-owned refs and draft store                     | No new retained structure                              | No resource allocation added by source change                                        |
| Scope/isolation    | keep    | Existing active draft id and component-local editor               | Reads only this creator's live editor                  | Save/remount restores the same prompt; blank draft stays empty                       |
| Rendering/hot path | fix     | Draft effect cleared validation text while preserving editor text | Seed state from the editor at the owning load boundary | Real ComposerInput, parent submit gate, submitted text and persisted snapshot tested |

## Commands and results

- `node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/components/ComposerInput src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.test.ts src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/inputPreparation.test.ts`: 15 files, 101 tests passed
- `node node_modules/eslint/bin/eslint.js src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.ts src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.test.ts --max-warnings 0 --report-unused-disable-directives`: passed
- `node node_modules/prettier/bin/prettier.cjs --check src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.ts src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.test.ts docs/org2-performance-guard-2026-09-09/SessionCreatorDraft.md`: passed
- `node scripts/quality/check-test-placement.mjs`: passed
- `git diff --check -- src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.ts src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.test.ts`: passed
- `node_modules/@typescript/native-preview/bin/tsgo --noEmit --pretty false`: passed

Performance verdict: pass for the scoped lifecycle invariant. The timer,
persistence, and repository-wide type checks pass. No CPU/RSS improvement is
claimed. The rebased branch has not been packaged and run in Tauri; the earlier
live reproduction covered recovery of the current draft and reaching the
short-input confirmation, not a provider response.
