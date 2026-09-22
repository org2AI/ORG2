# Market Package delivery acceptance

Updated September 18. The latest measured immutable build is `2a048d9e0b`,
incorporating develop `785402f812`. Preserved history, correct turn navigation,
restart continuation and accounting passed; explicit Codex Configure/Restore and
positive cache measurements passed on the preceding `91725` build.
The owner authorized merging this bounded source version on September 18 after
functional commit consolidation and current-head CI. Open official-App/business
acceptance below remains rollout work, not a claim of complete acceptance.
No ORG2 installer, Beta, tag or release is published.

See [Harry's UI handoff and screenshot gallery](HARRY-UI-HANDOFF.zh-CN.md).
Each linked report and screenshot applies only to its named build. Source tests,
ORG2 runtime, official App runtime, and production deployment are distinct evidence.

## Current acceptance matrix

| Area                       | Verified evidence                                                                                                                                                                              | Remaining gate                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Original-message Retry     | Three chained Retries retain correct native context; `91725` restores all eight real turns, correct navigation and preserved audit diagnostics through normal restart                          | No claim that every provider's Retry lifecycle was rerun on this build                                                                          |
| Cache and billing          | Final H: fresh 837 + cache 14,848 + output 12 = 15,697; one settlement 263/168/95 microUSD at admin 55%/35%. All three controlled failures add zero usage/charge                               | Cache-write coverage remains separate                                                                                                           |
| ORG2 Codex model switching | Earlier Luna → Terra in one frontend conversation retained context and matched receipts; final H uses Luna Reserve                                                                             | Ordinary supplier quotas prevent repeating ordinary-model switching; no quota bypass                                                            |
| Official Claude            | `95dc` two Sonnet 5 Packages, context, normal Quit/reopen and Restore → reconfigure → Open completed real calls                                                                                | Later build regression and different model families remain separately scoped                                                                    |
| Official Codex             | Earlier Luna → Terra in one Package retained context. Final `91725` explicit Configure/Restore returns isolated config exactly and preserves session history plus both checked primary configs | Dual-Package switching, reopen/inference after Restore and final compact-label confirmation remain open. Primary-chat import is not implemented |
| CLI configuration          | Earlier Claude Code `/model`, context and `--resume` passed; prior CLI disconnect preserved 44 protected files                                                                                 | Final CLI execution/restore is separate from official Codex configuration acceptance                                                            |
| Login and authorization    | Browser → native identity/recovery and normal-restart persistence have measured evidence; concurrency/CAS regressions pass source tests                                                        | Natural expiry/revocation and account/Cloud switching need explicit acceptance                                                                  |
| Credentials and suppliers  | Local upgraded s4 handles real Luna → Reserve calls and accurate settlement                                                                                                                    | Distinct-seller rotation and formal production CPA adapter delivery remain open                                                                 |
| Administrator access       | Cloud #118 company Feishu sign-in and allowlist pass for current user; three supplied application identities configured                                                                        | Harry and Junyu each need their own real sign-in                                                                                                |
| Resources                  | Final short visible/hide-shortcut samples; normal Quit removes exact tracked App/WebKit processes; same binary reopens successfully                                                            | Excludes external tools, sustained load and long-term memory; hide shortcut does not independently assert document visibility                   |

## Latest native regression

See [2a048 final-source continuation and complete frontend tests](evidence/2a048-final-source-regression.md).
It restores eight existing turns and completes a ninth real request; its zero-cache
usage is independently reconciled. The whole frontend suite passes 2,101 files /
15,831 tests, with three expected failures and two skipped.

See [91725 final restart, cache, restoration and resources](evidence/91725-final-regression.md),
[300203 third Retry and preserved-history recovery](evidence/300203-retry-recovery.md),
and the earlier [3efe observed defects](evidence/3efe-retry-chain.md).

Provider-local IDs must retain their native execution scope when projected onto
one conversation. Proven superseded failed prompts retain a structural audit
boundary in effective history, preserving diagnostics without adding logical user
turns or provider context. Raw transcripts are preserved. Final runtime now shows
A's READY and D's successful reply, keeps eight prompts/replies through restart,
and navigates exactly eight turns. Independent same-text requests stay distinct.
Existing anomalous older test histories remain preserved rather than silently
rewritten; a future-write guard does not claim historical repair.

Earlier source/runtime investigations are retained in [37a4](evidence/37a4-retry-acceptance.md),
[7cc4 hydration](evidence/7cc4-hydration-regression.md),
[7e06](evidence/7e06-regression.md), and [2441](evidence/2441-regression.md).

## Isolation and compatibility

- CLI connections use owned configuration overlays and supported history roots;
  official Apps use stable isolated profiles. Viewing configuration does not apply
  it. Restore must honor ownership and refuse conflicting external edits.
- Claude's OS account HOME remains intact while explicit configuration/data roots
  are isolated, preserving normal default-Keychain lookup. See the
  [launch correction](evidence/claude-keychain-launch.md) and
  [import and activation evidence](evidence/imported-history-and-activation.md).
- Official Codex GUI evidence is [reported separately](evidence/codex-95dc-gui.md).
  Do not describe copied text as faithful native history import.
- The later `37a4` Codex Restore interval overlapped a primary Claude startup and
  four primary Claude files changed. Read-only audit supports concurrent runtime
  writes but lacks exact writer tracing; the earlier 44-file equality does not
  apply to that interval. Do not roll back another process's current configuration.
- Cloud refresh uses shared rotation with identity/endpoint guards and CAS;
  logout invalidates stale completion. An expired token is not authorization.

## Deployment and unresolved accounting

Cloud #117/#118/#119 are merged and deployed, including migration, backend and
Console checks. Production deployment does not establish untested native-client
compatibility. Real local Reserve acceptance still depends on a locally upgraded,
unpublished CPA adapter; production pins the older adapter. Publishing a source
revision/image and verifying that rollout are separate work.

The historical 2,306-microUSD request has a balanced ledger but no unique purpose
correlation; a later title-call reproduction cannot identify it. See the
[attribution report](evidence/claude-code-title-call.md). The existing unidentified
request and its 9,252-microUSD hold remain unchanged. No reset, forced settlement,
history deletion or primary-App replacement is part of acceptance.

Raw receipts, lineage, resource samples and snapshots remain in the private
acceptance evidence store. Public documentation excludes credentials and private
machine paths. This source merge requires current-head CI and unchanged reviewed
production code. Broader release acceptance remains explicit in the matrix;
normal website deployment remains independent of an ORG2 desktop release.

The commit history is consolidated into Cloud refresh foundations, native App
connection lifecycle, Retry/history and usage, stable Package model selection,
and acceptance documentation. Functional tests remain with their owning changes.
Runtime evidence retains the original immutable build IDs; history consolidation
does not mean those calls were executed again. The bounded shell PATH wait does
not prove that a hung shell startup child terminates; that edge remains untested.
