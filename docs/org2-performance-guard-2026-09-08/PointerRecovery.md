# Interrupted pointer interaction recovery

Missed releases left component-owned drag state, resize-manager locks, listeners and queued frames alive after the global cursor fallback cleared DOM styles. Recovery now ends the owning interaction on blur, hidden visibility, pointer cancellation and movement without the primary button. Capture-phase listeners see events stopped by child controls. Pointer sessions ignore other IDs. The global fallback cancels stale release timers when a new press starts and skips timers for ordinary idle releases.

## Ownership and cancellation

- Shared pixel/ratio resize hooks: clear interaction state/listeners and pending pixel-resize frames. Ratio listeners exist only during a drag.
- Floating-window drag/resize: preserve current geometry, detach listeners; dragging also ends when disabled.
- CustomScrollbar: stop thumb dragging and preserve the scroll position.
- Column and split-panel resize: interruptions commit the last held-button size; unmount cancels pending frames without committing.
- useResizeController and SplitGroup: unlock ResizeManager and clear local/ghost state. Controller commits its last preview; SplitGroup preserves already-applied sizes.
- Gantt: cancellation discards the preview without writing task dates. Ordinary release still commits. State clears before consumer callbacks can throw.

All state is transient UI state. No stored-payload repair, historical cleanup, migration, dependency or protocol change is needed. Right-button presses do not start these left-button drags.

## Lifecycle evidence

| Area               | Verdict | Evidence                                                   | Change or reason kept                                                           | Verification                                                                       |
| ------------------ | ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Background work    | fix     | Missing terminal events retained movement listeners        | Shared active-drag lifecycle; capture phase; no polling or new timers           | Blur, hidden, cancellation, missed release, stopped propagation and disposal tests |
| Memory             | fix     | Retained cleanup closures and queued resize frames         | Clear owner refs, detach before terminal callbacks and cancel frames on unmount | No post-termination writes, symmetric listener removal and no pending frames       |
| Scope/isolation    | keep    | Per-component/document owners; no network or identity data | Pointer ID checks and owner-specific commit/cancel policy                       | Foreign-pointer and manager-unlock tests                                           |
| Rendering/hot path | keep    | DOM/frame-coalesced resize and scroll writes               | Preserve geometry math and scheduling cadence                                   | Existing resize-handle and Gantt virtualization suites                             |

The shared helper has no registry, polling or scheduled work. Listeners exist only for an active session and disposal is idempotent. Network, auth and transport dimensions are inapplicable. The tested trail-panel implementation remains unchanged. Native file dragging, DnD drop targets, text/editor controls, sliders and developer-tool gestures are outside this change; this is not a guarantee against arbitrary overlays or native WebView hit-testing failures.

## Verification

The isolated PR worktree was checked against current origin/develop. Nine focused suites cover 93 tests: AppGlobalRecovery, the two shared resize hooks, the shared drag lifecycle and owner integration, ResizeHandle, Gantt virtualization, trail resize and theme-overlay recovery. Typecheck, changed-file lint and diff checks also pass; the PR description records the exact commands.

The cross-owner `dragRecovery.test.ts` intentionally verifies the termination invariant against actual hooks/components, including no subsequent size, scroll or date writes. Normal release, pointer isolation, stopped propagation, repeated sessions and unmount are covered. Static screenshots would not demonstrate these event-sequence bugs and no layout/style changes were made.

Performance verdict: blocked for native measurement. The user's computer-control opt-in preference was respected. Automated DOM lifecycle checks pass; native hover behavior, CPU and frame-time improvements are not claimed.
