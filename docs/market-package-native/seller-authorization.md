# App-initiated package supply authorization

The App connections settings page offers **Sell compute → Connect Claude / Codex subscription**. The signed-in App authorizes the operation directly over HTTPS; the Market website and OS protocol callbacks do not carry this enrollment. Provider names select the required OAuth adapter, not a listing or a package pricing model. Package participation remains an account-owned Market backend resource managed on the website.

## Boundaries

- Frontend requests a public PKCE challenge from native, authenticates the desktop authorization request with its current Cloud OAuth session, and hands the resulting one-shot code back to native. The verifier, seller capability, provider code and provider credentials never return over IPC.
- Native compares its canonical owner lease and the grant's verified identity before any provider work. The grant fixes provider, region, origin and expiry. A webpage cannot choose a callback receiver, management URL or generic bearer.
- The native loopback receiver binds before opening provider authorization. It validates GET, loopback host, origin, path, one matching state and one bounded code. Forwarding reconstructs only the fixed provider callback and accepted state/code.
- Native completion reconciles an uncertain response through status, without replaying provider codes. The UI describes an uncertain result as unconfirmed and asks the user to inspect their accounts before retrying.
- The existing buyer package catalog is independent of this flow and of website navigation.

## Resource lifecycle

One native attempt and one per-store frontend operation may be active. No idle polling is added. OAuth opens a loopback listener only after an explicit connect action; callback, denial, expiry, cancellation or owner invalidation drops it. Frontend subscriptions and abort listeners are disposed in `finally` and on panel unmount. A pending proof expires after five minutes and is replaced after identity invalidation. Network requests and response sizes are bounded. The provider wait cannot outlive the short-lived seller capability. Once completion begins, the native task reads its authoritative outcome even if the initiating webview closes; a changed owner cannot receive that result.

The entry point uses shared Section and Button components, preserves the existing connection-card layout, and adds no raw action controls or custom button geometry. English and Chinese copy is provided; other locales use English fallback for this new section.

## Verification limits

Transport unit tests cover proof single use, substituted origin/provider/grant rejection, malformed callback rejection, callback cancellation/timeout and port release. Frontend tests cover direct desktop authorization, one active attempt, identity changes, cancellation during begin, malformed/oversized approvals and missing desktop OAuth. Native UI and official SJC business-flow acceptance must be recorded separately; these tests do not prove a real provider authorization, package enrollment or billable request.
