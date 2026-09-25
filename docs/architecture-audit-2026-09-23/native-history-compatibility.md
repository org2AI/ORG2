# Native history: architecture and necessity audit

Implementation reviewed: `86df4e6bd4d08f26497e74a3a156c4906758b04c`.
The subsequent documentation-only consolidation does not change runtime behavior.
Scope: PR #2103, same-client primary/managed raw-history last-write-wins (LWW).

## Current conclusion

The storage, launch, reader and continuation changes form one product objective:
preserve native history and safely resume it in either profile. Keep their
producing-boundary regressions. Remove dedicated upstream-release monitoring;
ordinary build/test/security CI remains unchanged. Layout #2110, Reserve #2143
and CPA support in cloud-infra #148 remain separate.

Bounded macOS product acceptance passed, including clean user text, C7 writer
contention, current streaming, Stop visibility and identical partial recovery
after reopen. This is not complete provider/platform or long-duration performance
certification. See the [current acceptance matrix](../org2-performance-guard-2026-09-24/native-history-acceptance.md).

## Necessity and scope decisions

| Area                                   | Verdict             | Reason and consequence                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude raw handoff                     | keep                | Vendor JSONL and registered account/project catalogs are authoritative. Whole-session publication replaces lossy semantic reconstruction; accepted hashes and native write clocks prevent rebound.                                                                                             |
| Claude namespace and writer gate       | keep                | Vendor registration cannot be replaced with an invented directory. Shared Open/background coordination, bounded scans and writer/owner checks guard transcript and catalog writes.                                                                                                             |
| Codex revision and native SQL          | keep                | History spans raw rollouts and SQLite projections. Stable revisions select the winner; compatible opaque columns survive. Required keys, relevant triggers and foreign-key contracts still gate publication.                                                                                   |
| Recovery and physical generations      | keep                | File rename and SQL commit are not one transaction. Durable snapshots repair interrupted publication; frozen fork ancestors require new physical rollout identities rather than in-place overwrite.                                                                                            |
| Persisted format readers               | keep                | Claude receipt v3, Codex journal v4 and snapshot v2 retain supported older-format readers. They protect real recovery state, not dead feature branches. Ambiguity pauses with artifacts intact.                                                                                                |
| Actual runtime/profile binding         | keep                | Configure/Open and publication verify the selected bundle, runtime generation, kernel arguments/environment and process lifetime. Version text alone cannot prove the running writer's identity.                                                                                               |
| Native defaults and bootstrap          | keep                | Bounded offline calls use the selected runtime/provider. The vendor initializes its own SQL schema; durable bootstrap ownership precedes creation so a lost reply cannot authorize duplicate creation or unrelated deletion.                                                                   |
| Current transcript resolution          | keep                | Path, body and revision resolve the current native SQLite rollout, including split auth/store homes. Indexed failures cannot fall back to retained stale files; legacy unindexed discovery rejects ambiguity.                                                                                  |
| Correlation metadata                   | keep                | The producer sends bounded turn intent in `turn/start.clientUserMessageId`, not visible user text. Full/windowed readers accept current and legacy metadata. Old XML is read for compatibility but no longer produced.                                                                         |
| Interrupted output and continuation    | keep                | Sparse finalized cache output is recovered only for a unique matching last native user intent, failed lifecycle and no native answer. Cold load, idle and terminal reconciliation share the rule. Before resume, the verified projection replaces stale rows and keeps the prepared user last. |
| Live rendering                         | keep                | CLI deltas use the existing session-scoped bounded live buffer; completion/reset/disposal clear it. Real body deltas can reopen premature completion; typing sentinels cannot. No second send/cancel dispatcher.                                                                               |
| Status and 15 locales                  | keep                | Both native app pages expose pending/writer-wait/LWW behavior with safe public reasons. Events are target/visibility scoped. This is status/copy work, not a layout redesign.                                                                                                                  |
| Dev/numbered-instance callback schemes | keep supporting fix | Eight files (+182/-4) repair isolated Configure/Open login. They can be extracted independently, but remain here as acceptance support. Callback ownership still requires the exact compiled scheme.                                                                                           |
| Dedicated canary workflows/drivers     | remove              | Four files (-490 lines) provided scheduled downloads/latest-release notifications outside the product objective. Direct opt-in native probes remain; no automatic upstream drift warning is promised.                                                                                          |
| Installation fingerprint               | simplify            | Bounded local metadata generations replace full bundle hashing. File/directory stamps and process-start checks remain; no persisted fingerprint format is introduced.                                                                                                                          |
| Dependency wiring                      | keep                | UUID v4 supplies fresh rollout/bootstrap identities; macOS TOML reads effective routing. Existing resolved versions are reused; no upstream version pin or upgrade churn.                                                                                                                      |
| Historical reports                     | consolidate         | Current conclusions and evidence index replace repeated chronological appendices. Prior failures and commands remain available at immutable links below.                                                                                                                                       |

## Authoritative boundaries and compatibility

- LWW copies whole native sessions; it does not merge messages. One changed side
  wins; both changed sides use stable native write time, with primary winning a
  tie. Unique losing-side messages can be overwritten.
- Destination credentials, routing and permissions remain destination-owned.
  Source identity, owner, revision and destination writer checks fence staging
  and publication. Old-build writers must finish before the new fence is relied on.
- Codex bare-model compatibility applies only to safe vendor-name syntax, never
  explicit `-org2-` or `claude-org2-route-` aliases. Stale/malformed aliases
  reject; an explicit second package remains explicit; Claude routing is unchanged.
  Bare-name syntax does not prove historical provenance. The default package's
  model/rates are the accepted fallback policy.
- Actual Codex plugin boolean overrides are accepted without allowing arbitrary
  route-changing arguments. Observed failed launches release only after the
  recorded process lifetime ends. Unknown launch outcomes remain conservatively
  fenced; this is not universal reservation recovery.
- Claude first use remains **initialize → quit Desktop/Code → reopen**. Vendor
  namespace creation precedes import, and live writers are never bypassed.
  Exit-time process disappearance and local configuration-lock contention no
  longer incorrectly terminate handoff; unreadable live processes fail closed.
- Historical remediation was not destructive: no manual history/cache deletion,
  lock truncation or raw rewrite was used for final acceptance. Ordinary
  authoritative projection reconciliation repairs transient duplicate UI state.

## Ten-layer review

| Layer                 | Coverage                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Compilation           | Recorded targeted Rust/TypeScript suites, typecheck/lint and CI; final merge checks are evaluated on the published commit.          |
| Dead code/duplication | Configure/Open/coordinator and send/load/idle/terminal call chains traced; obsolete semantic/list modes and canary drivers removed. |
| Naming                | Logical session, physical rollout, native authority and sparse finalized cache have distinct roles.                                 |
| Semantic overload     | Cached finalized events are not assumed to contain a complete native prefix; destination configuration is not portable history.     |
| Defaults              | Codex-only bare-model fallback and provider-matched native defaults; invalid explicit aliases and indexes fail closed.              |
| Domain boundaries     | Codex wire metadata is parsed at the provider boundary; shared projection recovery checks exact session and intent.                 |
| Clarity               | Consolidated reports now distinguish current results from superseded candidate failures.                                            |
| Wire/serialization    | Raw vendor fields survive; destination routing is applied separately; internal correlation leaves user text.                        |
| Initialization parity | Configure/Open share the selected runtime; bootstrap has durable ownership; cold/idle/terminal/continuation paths share recovery.   |
| Resolver symmetry     | Path/body/revision share current SQLite authority; managed/account roots and provider/model default evidence stay aligned.          |

## Limits and recovery

Recent-50 selection and per-pass/file/projection limits bound individual work.
Retained generations are native dependencies, not disposable backup clutter;
capacity exhaustion pauses sync. No automatic ancestor GC or general undo exists.
Staged snapshots can be orphaned by crashes before journal publication or failed
best-effort cleanup; this ordering predates the PR and is not a global disk bound.

Stop synchronization and preserve raw files, snapshots and journals before
rollback. Use readers compatible with the persisted formats. Complete known
extended launch reservations with the new binary and normal native exit; never
truncate an uncertain lock. Reverting source cannot recover overwritten text.
Private Darwin process ABI and evolving native SQL/wire contracts remain
compatibility risks; capability mismatch pauses rather than guessing.

## Evidence index

- [Full pre-consolidation audit and exact historical commands](https://github.com/org2AI/ORG2/blob/86df4e6bd4d08f26497e74a3a156c4906758b04c/docs/architecture-audit-2026-09-23/native-history-compatibility.md)
- [Full pre-consolidation performance chronology](https://github.com/org2AI/ORG2/blob/86df4e6bd4d08f26497e74a3a156c4906758b04c/docs/org2-performance-guard-2026-09-24/native-history-acceptance.md)
- [Product contract](../design/native-history-last-write-wins.zh-CN.md),
  [native compatibility](../native-history-compatibility.md) and
  [retention constraints](../design/codex-history-retention.md)
