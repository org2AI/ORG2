# App-initiated package supply authorization

The Market website owns seller management and its account-connection entry point. Its `market/seller/connect` shortcut opens a transient shared App confirmation dialog showing the selected service and the current App account. The user must confirm that this is the same identity used on the website before provider authorization begins. There is no permanent seller-management panel in App settings. After confirmation, the signed-in App authorizes directly over HTTPS; no browser approval callback is needed. Provider names select the OAuth adapter, while package participation remains an account-owned backend resource managed on the website. Buyer package discovery remains independent of every shortcut.

## Boundaries

- Frontend requests a public PKCE challenge from native, authenticates the desktop authorization request with its current Cloud OAuth session, and hands the resulting one-shot code back to native. The verifier, seller capability, provider code and provider credentials never return over IPC.
- Native compares its canonical owner lease and the grant's verified identity before any provider work. The grant fixes provider, region, origin and expiry. A webpage cannot choose a callback receiver, management URL or generic bearer.
- The native loopback receiver binds before opening provider authorization. It validates GET, loopback host, origin, path, one matching state and one bounded code. Forwarding reconstructs only the fixed provider callback and accepted state/code.
- Native completion reconciles an uncertain response through status, without replaying provider codes. The UI describes an uncertain result as unconfirmed and asks the user to inspect their accounts before retrying.
- The existing buyer package catalog is independent of this flow and of website navigation.

## Resource lifecycle

One native attempt and one per-store frontend operation may be active. No idle polling is added. OAuth opens a loopback listener only after an explicit connect action; callback, denial, expiry, cancellation or owner invalidation drops it. Frontend subscriptions and abort listeners are disposed in `finally` and on dialog-host unmount. A pending proof expires after five minutes and is replaced after identity invalidation. Network requests and response sizes are bounded. The provider wait cannot outlive the short-lived seller capability. Once completion begins, the native task reads its authoritative outcome even if the initiating webview closes; a changed owner cannot receive that result.

The transient confirmation uses shared Modal and Button components. Existing connection-card layout is unchanged. Confirmation and result copy is provided in all 15 locales; the removed permanent panel's translation keys are deleted. Strict parsing rejects duplicated fields and passes the selected region unchanged. Closing or changing owner cancels consent and any started authorization.

## Verification limits

Transport unit tests cover proof single use, substituted origin/provider/grant rejection, malformed callback rejection, callback cancellation/timeout and port release. Frontend tests cover direct desktop authorization, one active attempt, identity changes, cancellation during begin, malformed/oversized approvals and missing desktop OAuth. Native UI and official SJC business-flow acceptance must be recorded separately; these tests do not prove a real provider authorization, package enrollment or billable request.
