# Component dependency follow-up

Acceptance: all six remaining helper-only seams have dedicated owners, callers use them directly, the existing UI and Git provider lifecycle stay unchanged, and focused boundary/behavior tests, TypeScript and scoped lint pass. This sweep does not introduce lazy loading, new caches or polling.

| Boundary                 | Former owner                                | New owner                                       | Invariant                                                                       |
| ------------------------ | ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Panel header tokens      | PanelHeader renderer                        | PanelHeader/tokens.ts                           | Same token values; token-only callers do not import header UI                   |
| Workstation trail tokens | WorkstationTrailSurface renderer            | blocks/workstationTrailTokens.ts                | Same width/rail classes; layout calculations do not import trail UI             |
| Email classifier         | EmailMessageBubble renderer and broad utils | Communication/emailBubbleEvent.ts               | Same tool names and strict transcript marker check; no tool registry dependency |
| Submission data          | SubmissionsContent renderer                 | SessionReplay/submissionsData.ts                | Same artifact normalization, first-seen ordering and deduplication              |
| Markdown tabs            | MarkdownEditor renderer                     | MarkdownEditor/useMarkdownEditorTabs.ts         | Same translated labels and memo dependency; wizard hook avoids editor UI        |
| Git status reads         | GitStatusProvider and provider barrel       | GitStatusContext/context.ts and useGitStatus.ts | One context singleton; readers avoid provider/watcher imports                   |

## Ten-layer review

1. Compilation: full TypeScript and scoped lint verification recorded in the PR.
2. Ownership/dead code: definitions moved, not copied; equivalent helper-only callers migrated. Intentional provider/component APIs retain their render exports.
3. Naming: existing exported names and meanings retained; new filenames identify the shared owner.
4. Semantic overload: no domain term changes; UI renderers, data projection and context reads now have distinct owners.
5. Defaults: email markers, artifact fallback/dedupe, tab order/labels and missing-provider error preserved.
6. Cross-domain leakage: leaf modules do not import their former renderer/provider. This is the central repaired invariant.
7. Discoverability: imports name token, classifier, projection or read-hook owners directly.
8. Wire/serialization: intentionally no payload, schema, persistence or IPC changes; no live payload dump needed.
9. Init parity: both deferred placeholder and active Git provider use the same context; scheduling/watcher bodies unchanged. Other leaves have no initialization side effects.
10. Resolver symmetry: submission field precedence moved intact, with focused derivation tests. No resolver policy changes.

## React performance and lifecycle

Applicable: heavy dependency boundaries and context ownership. No Next.js/RSC/SWR changes apply. Static graph tests demonstrate source isolation only; tree shaking and legitimate render consumers can retain emitted code. No bundle-byte, startup-time, memory or frame-time improvement is claimed. The Git lifecycle review and deferred mount tests cover context identity and scheduled handoff/cleanup; native WebView profiling is unverified.

UI consistency findings are in the scoped frontend audit reports. JSX and styling values are unchanged. Rollback is a normal revert; there is no data migration or dependency/configuration change.
