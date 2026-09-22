# Mobile TestFlight UI audit

Release-snapshot control review. TypeScript AST inspection covered the 118 changed production TS/TSX files; manually inspected the native-element results, shared Button props/presentation, session menu and tool-detail close control. This is a focused control audit, not a claim of full visual or accessibility acceptance across the feature set. Real-device VoiceOver, large text, dark theme and post-login screenshots remain unverified.

| Line                                                                                 | Element                   | Verdict          | Reason                                                                                             | Suggested change |
| ------------------------------------------------------------------------------------ | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MobileRemote/components/composer/MobileComposerAttachmentButton.tsx:39` | Native file input         | keep with reason | Hidden browser file-picker boundary; a shared text input cannot replace file selection             | None             |
| `src/modules/MobileRemote/platform/writeClipboardText.ts:18`                         | Temporary native textarea | keep with reason | Synchronous legacy clipboard DOM boundary restores focus/selection and removes the node in finally | None             |
| `src/modules/MobileRemote/components/SessionViewMenu.tsx:35`                         | Grouping dropdown         | keep with reason | Reuses shared Dropdown and its item icon/spacing tokens; mobile CSS constrains viewport sizing     | None             |
| `src/modules/MobileRemote/components/SessionViewMenu.tsx:108`                        | Menu trigger              | keep with reason | Shared Button with iconOnly, accessible name and expanded state; touch geometry uses mobile token  | None             |
| `src/modules/MobileRemote/components/transcript/MobileToolDetailModal.tsx:91`        | Close action              | keep with reason | Shared Button and Modal; named icon action uses a small glyph within a token-sized touch target    | None             |

AST review found no raw JSX action buttons or clickable div/span substitutes in the changed production files. Native creation inspection found only the clipboard textarea boundary above. Role-bearing status/log/dialog containers are informational or structural, not action substitutes.

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

## CI follow-up: provider ownership and lifecycle

The provider was over the 700-line gate. Context, connection state, authenticated handshake, RPC notifications and session actions now have separate owners. The existing socket wait helpers are reused. Three former connection helper modules had no production callers (only references among themselves); they were removed rather than retaining a second obsolete connection implementation.

Architecture review covered compilation, live call paths/dead helpers, names, responsibility boundaries, fallback/error branches, initialization and resolver parity (layers 1–7, 9–10). Layer 8 wire verification is limited to the existing transport contract tests: no payload fields changed in this CI follow-up, and no production relay session was exercised. The provider remains the generation/retry dispatcher; extracted hooks receive its same stable refs. RPC availability is now React state as well as the imperative transport ref, so read-state and inbox consumers update on disconnect. Authentication/connection ref mirrors update in layout effects; successful handshake still publishes connection identity synchronously before restoring the transcript.

The reconnect factory only stores its callbacks and never invokes them during construction. Two narrowly documented React Compiler ref warnings at that factory call are false positives; event-time generation guards remain intact. No general lint rule or baseline was relaxed. Promise rejections from background teardown and observer callbacks now have final handlers; normal RPC errors retain their existing UI paths.

| Area               | Verdict | Evidence                                                                              | Change or reason kept                                    | Verification                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Background work    | keep    | Reconnect controller owns one timer/flight; provider closes transport on hide/unmount | Extraction preserves teardown and visibility dispatch    | Existing provider/reconnect tests; physical-device idle measurements not run |
| Memory             | keep    | Read-state batches 200, watched IDs 1200, paired-desktop inventory 20                 | No additional cache or polling                           | Existing read-state/inbox tests                                              |
| Scope/isolation    | keep    | Account/endpoint/desktop draft key, connection generation, selection intent           | Preserve scoped draft recreation and stale-result guards | Provider pairing/revocation/recovery tests                                   |
| Rendering/hot path | fix     | RPC ref previously read directly for rendered consumers                               | Publish matching RPC state at client creation/release    | Provider and read-state regression suite                                     |

Performance verdict: blocked for full-device acceptance: physical-device visible/hidden CPU/RSS and production relay transitions were not measured. Unit lifecycle coverage is not a claim of production performance improvement. UI control verdict remains 0 fix, 5 keep with reason, 0 abstract; callback wiring still uses shared Button controls.
