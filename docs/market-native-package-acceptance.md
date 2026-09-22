# Native Package acceptance checklist

This checklist records the remaining real business-flow acceptance. Passing
unit, isolated filesystem or loopback HTTP tests does not complete these rows.
Use a debug instance and isolated test wallet; do not publish an installer or
merge Package PRs as part of this run.

## Preconditions

- Local Console, control service and gateway are healthy and use the intended
  release checkout and cloned database. Record their commits and database name.
- The browser and debug ORG2 instance authenticate through standard Cloud OAuth
  as the same identity. Use the in-app browser for every web step.
- At least two enabled purchases expose an overlapping model. Record purchase
  IDs, version IDs, exact native-client capabilities and configured buyer/seller
  rates. Rates come from Admin Dashboard; range maximum/minimum are defaults.
- Capture fresh private backups and hashes of each external application's
  actual configuration directory before applying a connection. Identify the
  running process's configuration root. Do not modify the configuration root
  of the Codex task conducting this acceptance.
- One upstream account per provider can verify provider calls and short-token
  renewal, but cannot verify same-provider account rotation. That row requires
  two authorized, healthy accounts of the same provider.

## Evidence matrix

| Flow                       | Action and required evidence                                                                                                                                                                                                              | Current result                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web enrollment, signed out | Enable a Package, follow its original deep link, complete standard Cloud OAuth once, and confirm native enrollment resumes for the same identity without a second Market browser authorization                                            | 8e86: Cloud logout and web open restore the same Cloud identity; existing Market grant reused. First enrollment without an existing grant remains pending                                                |
| Web enrollment, signed in  | With a valid Desktop OAuth identity already signed in, open an enabled Package and confirm background enrollment completes without another browser authorization; an unsupported legacy identity upgrades through standard Cloud OAuth    | Existing enabled Packages visible; new grant issuance/exchange not established by the 8e86 logout roundtrip                                                                                              |
| Identity mismatch          | Use a mismatched native identity and confirm the original enrollment cannot bind to it                                                                                                                                                    | Pending                                                                                                                                                                                                  |
| Internal ORG2, default SDE | Open the normal Account Key/model picker in default SDE, select each of two purchases sharing a model, send a real request and a continuation, and correlate UI response with exact purchase/request/receipt IDs; no App Connection setup | 10b43fb6f: two same-model purchases, first turns and Beginner continuation passed real calls and ledger audit                                                                                            |
| Selection refresh          | Keep the picker closed while enabling a Package, reopen it, and confirm the new Package appears immediately; close/reopen repeatedly without starting background polling                                                                  | Hook regression coverage; native UI pending                                                                                                                                                              |
| Multi-runner selection     | Select different Package/model sources for separate runners and confirm each dispatch retains its own source; a previous global Account Key must not replace either selection                                                             | Pending                                                                                                                                                                                                  |
| Claude Code                | Configure two Packages together, open through App Connection, select each alias in the native picker, and complete a real call for both                                                                                                   | 8e86: internal ORG2 Claude Code GUI first turn, continuation and second purchase passed. External App Connection picker/Open still pending                                                               |
| Claude Desktop             | Configure two Packages together, open the native Code surface, select each alias, and complete a real call for both                                                                                                                       | Pending                                                                                                                                                                                                  |
| Codex native App           | Use an isolated native configuration root, configure two Packages, select both aliases in the actual App picker, and complete a real call for each                                                                                        | Pending                                                                                                                                                                                                  |
| Overlapping model routing  | For identical actual model names, observe distinct aliases and verify each real request uses the selected purchase, session and credential; unknown aliases must fail without dispatch                                                    | 10b/8e86: SDE and internal Claude Code real requests retained exact distinct purchases. External app aliases remain pending                                                                              |
| Settlement                 | Record admitted price snapshot and normalized usage; independently compute buyer debit and seller credit using configured rates and documented rounding, then correlate ledger and receipt by request ID                                  | 10b SDE: 11 requests, $0.162013 buyer total; 8e86 SDE restart: 6 requests, $0.027795; internal CC: 3 requests, $0.071839. All settled and independently reconciled                                       |
| Token renewal              | Reuse the same native selection past its short service-token window; verify a fresh token is acquired, call succeeds, and token values never enter persistent config or reports                                                           | Pending; planned same-process gateway-token window interrupted by explicit Cloud logout. Gateway token is 15 minutes; Market native access session is 12 hours; the observed Cloud OAuth token is 1 hour |
| Upstream account rotation  | Cause an authorized local rotation scenario between two same-provider accounts; verify second-account dispatch and exactly one settled request                                                                                            | Pending; second account required                                                                                                                                                                         |
| Internal restart           | Quit ORG2, confirm process exit, restart the debug instance, reopen the SDE conversation, and continue using the persisted Package/model selection without falling back to an Account Key                                                 | 8e86: SDE two purchases restored and called successfully after normal macOS Keychain authorization; internal CC restart remains pending                                                                  |
| External App restart       | Quit ORG2 and external App, confirm process exit, restart the debug instance, reopen through App Connection, and call each persisted alias again                                                                                          | Serialized metadata/filesystem coverage only                                                                                                                                                             |
| Config conflict            | Make a reversible external config edit; apply and restore must refuse to overwrite it. Revert that edit to its captured bytes before continuing                                                                                           | Isolated filesystem coverage only                                                                                                                                                                        |
| Restore                    | Disconnect via App Connection; verify original config and any preexisting catalog bytes against fresh backups and confirm no managed process remains                                                                                      | Isolated filesystem coverage only                                                                                                                                                                        |

## Evidence handling

For every real call record application/version, purchase/model alias, actual
wire model, request ID, usage totals, pricing snapshot, buyer debit and seller
credit. Keep credentials, raw login cookies and access/refresh tokens out of
screenshots, command output, PRs and tracked files. Do not treat a synthetic
HTTP fixture as upstream success or configuration reload as native restart
acceptance.

For the default SDE path, inspect only nonsecret source metadata in durable
session records. The recorded purchase and model must survive continuation
and restart together. Bearer tokens belong in the existing credential store,
not the session record. Revoked or unavailable selections must fail clearly
without silently choosing another Package, model or Account Key.

After restoration, compare all affected files to their recorded pre-run
hashes. Preserve concurrent user changes and report conflicts instead of
force-restoring old backups.

Claude Desktop 2.110.1 reads `deploymentMode` from
`Claude-3p/claude_desktop_config.json`, beside `configLibrary`. ORG2 owns only
that field in this runtime preferences file: native preference additions must
survive reapply and restore, while an external change to `deploymentMode`
must block both operations. The transaction still uses full-file snapshots
and hashes to reject concurrent writes. Older active ORG2 manifests pointing
at `Claude/claude_desktop_config.json` require Restore before applying the new
target; no automatic rewrite of old ownership is performed.

The installed packaged Claude Desktop removes `CLAUDE_USER_DATA_DIR` unless
its signed internal harness authorization validates. `CLAUDE_CONFIG_DIR`
alone isolates Code settings, not the Desktop application. Do not bypass that
validation or claim a CLI invocation verifies the native Desktop UI.

## Logout and account isolation acceptance

The 8e86 normal Cloud logout test restored a newly issued Cloud token for the
same identity after a user clicked the local Market deep link. The model picker
showed both enabled purchases, but the Market connection and authorization
records still came from the earlier enrollment. Reusing a valid grant for the
same identity is allowed; it does not prove enrollment without a saved grant.

Review also found that this artifact does not bind every saved Market source to
the current Cloud identity. Its successful calls are historical evidence only,
not acceptance of the pending identity-isolation fix. Do not ship this gap.

| Scenario                                                 | Required result                                                                                                                                          | Evidence status                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Normal Cloud logout with an old Package selected         | Package inventory disappears; old SDE/CC sessions and external proxy calls fail before Market dispatch; ordinary Account Keys keep their normal behavior | cd93: normal Logout shows Login; old CC denied before dispatch and debit                              |
| Sign into another Cloud account or change Cloud endpoint | No previous owner's Package, cached credential or delayed selection is usable                                                                            | Pending fixed artifact and account-switch coverage                                                    |
| Same account token refresh                               | Existing valid Package selections remain usable without a second browser consent or background polling                                                   | Pending fixed artifact                                                                                |
| Same account logout then web open                        | Normal Cloud identity recovery restores that account's permitted purchases; any saved grant reuse is explicitly identified                               | Cloud UI recovery observed on 8e86; fixed artifact pending                                            |
| Web open without a saved Market grant                    | One normal Cloud login flow followed by actual native issue/exchange and matching purchase discovery, without another Market authorization page          | Pending                                                                                               |
| Logout while enrollment or selection is in flight        | Late authorization, consent, prepare and credential results cannot recreate or use the old identity's state                                              | Source tests pass; logout during blocked Keychain work persisted; late-enrollment UI coverage pending |
| Restart while signed out                                 | Saved Package grants remain unusable until the matching Cloud identity is authenticated                                                                  | cd93: signed-out restart retains Login and old CC denial; zero dispatch/debit                         |

For the fixed artifact, record its source commit and binary hash separately.
Do not use a UI-only filter or a manually invoked helper as proof that native
credential acquisition enforces this boundary. Same-identity token refresh and
ordinary Account Key use are compatibility checks, not exemptions from testing.

The first 8e86 restart attempt failed before dispatch with
`credential_operation_busy`: macOS Keychain was waiting for the user's normal
authorization of the new private build. It made no Market request and incurred
no debit. After authorization, the same build completed both SDE restart calls;
no timeout, credential-store bypass or fabricated session was used.

## Rebuilt owner-isolation acceptance, 2026-09-17

The private artifact source is `cd93acee997613b82e33d760fd3224e69c9db818`;
its binary SHA-256 is
`37b56bc5b9209d167f1cc46c0b90cd99ca8003711385f57ad1b8203c72b73fca`.
The later `670e9edcc` commit moves a test only. The subsequent bootstrap
rejection-handler change adds a `.catch` reaction and has separate unit/CI
coverage; this artifact was not built from that later source.

With Cloud auth present and matching saved Market metadata, the Package
inventory status call waited in `Grant::load` through the macOS Keychain
security service. The attempted old Claude Code continuation returned
`412 credential_operation_busy`. There were no new Package requests or ledger
postings. This is blocked positive acceptance, not a successful model call;
matching local identity metadata alone does not prove server verification.

Normal Cloud Logout immediately showed Login and persisted null canonical
Cloud auth while the old Keychain work was still waiting. Retrying the saved
Claude Code session returned `412 market_cloud_sign_in_required`. After normal
quit and restart of the same artifact, Login and that denial persisted. The
final PostgreSQL observation at 09:42:29.645 UTC showed zero new requests and
postings; the one pre-existing unresolved request and its financial state
were unchanged. Saved grant metadata remained stored but had no current owner.

A 55.37-second visible, signed-out idle observation after restart contained 12
rooted process samples: CPU 0.6–2.3%, RSS 91.9–96.6 MiB. Launchd-owned WebKit or
separately launched Apps may be outside this process set. There is no
comparative baseline, signed-in or hidden idle measurement, so this does not
establish a performance improvement or complete lifecycle acceptance.

The fixed source still needs positive calls after normal OS credential
access, same-owner relogin, fresh web enrollment, account/endpoint switching,
and the external native-App flows in the matrix. Earlier artifacts' calls and
settlement evidence remain historical. No Package merge or installer release
is justified by the negative checks above.
