# Session composer outside-click focus

## Cause and correction

Session composers use `contenteditable`. On non-selectable app background,
WebKit retains the document selection after `HTMLElement.blur()`. The next
keystroke restores editing focus and inserts into that retained range. Checking
only `document.activeElement` therefore gave a false positive.

The outside-click policy now releases both focus and a selection wholly inside
the original composer. It retains a selection made elsewhere and never blurs
the destination input. The original composer is captured before the browser's
default focus transfer. The deferred decision uses one cancellable timeout:
native event dispatch can run microtasks between listeners, before descendant
insertion controls have called `preventDefault()`.

The shared shell retains its existing padding-click focus behavior. Ordinary
inputs are excluded. There are no persistence changes or historical data to
repair.

## Verification

- Headless WebKit and Chromium used the production blur module and shell click
  handler, with contenteditable and non-selectable-background DOM fixtures.
  Real pointer clicks and keyboard typing exercised the editing behavior.
- Removing selection release reproduced the failure in WebKit: `draft` became
  `draftLEAK` after clicking outside and typing. Chromium did not reproduce it.
- With selection release, both engines retained `draft`. Re-entry, prevented
  insertion controls, destination inputs, and shell padding passed in both.
- 29 focused Vitest tests passed, including retained selection, preservation of
  unrelated selection, destination focus, and listener/timer disposal.
- Changed-file ESLint, TypeScript typecheck, formatting, test placement, and
  `git diff --check` passed.
- Added a real click/typing regression to `composer-skills-ui.spec.mjs`. Its
  syntax was checked; the native Tauri suite was not run. Headless fixtures are
  browser-engine evidence, not full-app or native-window verification.

## Performance guard

| Area               | Verdict | Evidence                                                    | Change or reason kept                                      | Verification                                    |
| ------------------ | ------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Background work    | keep    | One listener per app bootstrap                              | Event-driven; no polling or idle work; cleanup removes it  | Disposal test                                   |
| Memory             | fix     | At most one pending callback holding an editor/event        | New clicks cancel pending work; teardown cancels it        | Timer cancellation test                         |
| Scope/isolation    | fix     | Captured composer element, checked for connectivity         | No settings, account state, or cross-window references     | Destination-focus and ordinary-input tests      |
| Rendering/hot path | keep    | DOM-only handling; no React state updates or document scans | Constant retained state; ancestor traversal on interaction | Source inspection and browser interaction tests |

Lifecycle coverage: installation, active clicks, focus transfer, and disposal
are tested. Visible/hidden idle have no scheduled work beyond the one pending
click callback. Each window owns its own bootstrap/listener. Network, provider,
identity, and persistence lifecycle dimensions do not apply.

Performance verdict: pass for the bounded event-listener lifecycle. No CPU or
memory improvement is claimed; native Tauri interaction remains unverified.
