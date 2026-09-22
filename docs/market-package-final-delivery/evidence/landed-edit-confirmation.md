# Preserve execution-child history when editing a projected message

The canonical root displays child-native events via
`projectVerifiedLocalExecutionTail`, which namespaces IDs as `runlanded-` and
sets `sessionId` to the root. The user row's completed delivery status does not
prove the subsequent provider response succeeded. No supported child-scoped
rewind contract exists in this action across subsequent execution segments.

The previous hook treated every such row as a failed retry and silently
appended it. Equal text also reused the historical intent identity, which could
collapse a valid old turn. Rewinding the root was not a safe alternative.

The action now asks **Send as a new message?**, explaining that existing
messages and file changes remain. Cancel or dialog failure performs no send or
history mutation. Approval mints a new turn identity and uses the canonical
router; existing history is preserved. A session switch or unmount while the
dialog is open cancels the pending action. The proven synthetic failed-queue
path remains unchanged and does not show this dialog.

A future one-click retry for a landed provider-failed tail requires reliable
failure ownership/action metadata. Do not infer it from API-error text or from
a user row's delivery status. This change adds no history deletion or migration;
previous history is left intact.

Verification: the hook suite covers cancel, unavailable dialog, session switch,
unmount, approved same-text fresh identity, edited fresh identity, canonical
router/fallback, and existing durable failed-owner retry cases. Native dialog
visual verification and successful final-build Retry remain pending.

Performance scope: one user-triggered existing native dialog; no polling,
background retry, cache, retained history copy, or subscription is introduced.
The dialog uses the existing shared scheduler. A current-session resolver is
cleared on unmount so delayed confirmation cannot dispatch into an old surface.
No runtime CPU/RSS improvement is claimed.
