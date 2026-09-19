# Account package discovery verification

## Behavior and boundaries

The signed-in desktop account owns package discovery. Opening the package picker
uses existing ORG2 grants or establishes one using desktop OAuth and the existing
PKCE HTTPS endpoint. Website links are optional navigation. Provider adapters and
historical stored grants are not removed: package discovery must not filter valid
grants by a new workspace naming convention.

The account authorization flight and package cache are scoped to the Jotai store
and current Cloud owner. Identity changes invalidate pending results. A shared
focus event invalidates each store once, even with both open and closed pickers.
There is no new polling timer.

## Native evidence (2026-09-19, macOS)

Built the actual Tauri app from develop plus this change, using production frontend
assets and the market-connect feature. Opened Settings → App connections → Configure
inside the app without a website link.

- Provider choice cards have visible vertical padding and multiline descriptions.
- The Connection card opens the existing connection/profile editor.
- ORG2 Market opens the package picker; the loading state resolves to a retryable
  error. Retrying reaches the same authorization boundary.
- Bounded native frontend diagnostics record `market_request_failed_http_503`.
  The official authorization service lacks its desktop identity configuration.
- No successful native package catalog, model request, seller onboarding, billing,
  or admin reconciliation is claimed. These remain required acceptance work.

## Lifecycle audit

| Area            | Verdict | Evidence                                                           | Decision                                                                   | Verification                            |
| --------------- | ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| Background work | keep    | Focus listener owned by each mounted hook, removed on cleanup      | No timer; closed picker only invalidates                                   | Open/closed two-consumer focus tests    |
| Memory          | keep    | WeakMap per store; one catalog/flight and one last focus event     | No new unbounded collection                                                | Existing cache and identity tests       |
| Scope/isolation | keep    | Cloud owner captured before work and checked on completion         | Cancel/discard stale identity results                                      | Account-switch and single-flight tests  |
| Rendering       | fix     | Standard Button adds inline geometry and a truncated label wrapper | Shared custom-layout choice card owns multiline geometry and token surface | Native screenshot and editor navigation |

No CPU/RSS improvement is claimed. Successful package execution and its full native
lifecycle cannot be measured while the authorization service is unavailable.
Performance verdict: blocked at the native package authorization boundary.

## UI audit

ConnectionChoiceCard continues to use the shared Button. Custom layout is necessary
because selectable cards own multiple child rows, wrapping, padding and selection
surface. Colors use existing tokens; pressed, disabled and keyboard-focus states
remain present. No raw or substitute action elements are introduced. This restores
card geometry without reverting the shared Button API migration.
