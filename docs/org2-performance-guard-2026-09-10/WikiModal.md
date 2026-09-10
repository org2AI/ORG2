# Wiki modal lifecycle review

Production entry: account-menu Wiki action → lazily imported WikiModal → WikiBrowser. Existing onboarding event, host and developer-mode gate are unchanged. Wiki is available independently of developer mode.

| Area               | Verdict | Evidence                                                                           | Change or reason kept                                            | Verification                                    |
| ------------------ | ------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Background work    | keep    | No timers, effects, listeners, network requests or provider controllers introduced | Mount only when opened                                           | Menu open/dismiss test                          |
| Memory             | keep    | Ten static articles; local query and selected article ID                           | Close unmounts the modal and resets local state                  | Escape/reopen test                              |
| Scope/isolation    | keep    | Public English text only; no account data, keys or persistent state                | Independent per mounted menu                                     | Signed-out/non-dev menu test                    |
| Rendering/hot path | keep    | Search scans the fixed-size catalog on input; one article renders                  | Fixed sidebar and one article scroll region; no scroll listeners | Search and navigation tests; typecheck and lint |

Visible/hidden idle performs no new scheduled work. Network, account, endpoint, provider ingestion and multi-instance transport lifecycles are inapplicable to this public local documentation. Existing shared Modal/Input lifecycle behavior is reused. No runtime CPU/RSS improvement is claimed.

Verification: targeted wiki, onboarding and menu tests; TypeScript typecheck; scoped ESLint; diff whitespace check. Actual Tauri rendering, scroll behavior and CPU/RSS were not measured because computer control was not authorized.

Performance verdict: pass for the bounded local UI resource surface; actual visual layout remains unverified.
