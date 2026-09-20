# Website-owned seller authorization

The Market website owns seller account connections, provider approval, region
selection and package participation. The website session determines the seller
identity. ORG2 does not authorize a seller using its signed-in desktop account and
does not show a second seller confirmation dialog.

Where the provider redirects to localhost, the website supports submitting the
callback address to its session-owned completion endpoint. The server must enforce
session ownership, provider state, expiry and one-time completion. A localhost
callback does not require ORG2 to be running. The desktop has no seller callback
listener or seller enrollment IPC commands.

Retired `market/seller/connect` shortcuts cannot begin authorization or enroll
supply. Existing buyer enrollment, identity isolation and package discovery remain
intact. The App discovers packages from its own signed-in account independently of
website navigation. Website links for seller management remain website links.

## Acceptance boundary

The final website flow has historical successful provider authorization, supply
enrollment and native package-call/ledger evidence. The earlier App-owned seller
experiments were removed and cannot establish acceptance of the website's final
cancellation or recovery behavior. See the versioned evidence and limitations in
[Account package discovery verification](../market-account-discovery/verification.md).

Cloud tests additionally exercise callback ownership/state/expiry, cross-process
completion/cancellation, duplicate provider identities and restart cleanup with a
real isolated database and mock provider. These are not a replacement for final
website OAuth cancellation/restart UI acceptance, independent buyer/seller testing
or Stripe payment and payout acceptance.
