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

Previous native seller experiments reached the official provider login page but
did not complete provider OAuth or enroll supply. Those experiments do not verify
the website-owned flow. The website manual callback, new supply enrollment, native
package execution through the selected region, and corresponding buyer/seller/admin
ledger reconciliation require fresh end-to-end acceptance.
