# Native History Sync: Last Write Wins, Preserve Content As-Is

Date: 2026-09-23

Status: The user has confirmed the product tradeoffs; this document is the implementation and acceptance basis. **Implementation has been replaced according to this plan; full native product acceptance remains outstanding.**

Related PR: https://github.com/org2AI/ORG2/pull/2103

## 1. Confirmed Goals and Tradeoffs

The 1P environment and the ORG2-managed 3P environment for the same type of native client on the same machine share conversation history.

- Sync one conversation at a time; do not overwrite the entire database, user directory, or profile.
- When one side changes, that side wins.
- When both sides change, use the later write; do not merge messages or ask the user to choose a conflict version.
- Do not retain old snapshots, version backups, or a restore entry point for overwritten content.
- The user accepts that messages unique to the earlier copy may be overwritten and unrecoverable when continuing conversations on both sides at the same time.
- Preserve message bodies, tool calls and results, native UUIDs, and additional fields as close to their original bytes as possible; do not reconstruct them through ORG2's transcript format.
- Do not use an App release-version allowlist, and do not block native history sync because an unknown message field appears.

This is a handoff between two environments of the same client, not a format conversion between Claude and Codex.

## 2. Why the Existing Implementation Is Changing

Claude's initial import currently copies the transcript as-is, but subsequent write-back first validates against a field allowlist, then filters run records, rewrites parent-child relationships, and maintains conversion records. The two paths therefore carry different semantics.

Real Claude Code 2.1.281 can read, continue, and save test histories successfully, while ORG2's production parser rejects some records it generates. This failure first indicates that ORG2's conversion rules are incompatible; it does not justify concluding that the native applications' two environments are incompatible.

The new plan separates the two responsibilities:

| Layer | Responsibility | Effect of unrecognized content |
| --- | --- | --- |
| Native history sync | Integrity, conversation ownership, update ordering, safe publication, and necessary native indexing | Preserve ordinary message fields as-is |
| ORG2 transcript display | Extract displayable content for the ORG2 UI | May report that a preview is unsupported; must not block native sync |

Do not maintain a complete message-field model or infer the execution semantics of every tool just to perform synchronization.

## 3. Precise Meaning of “Last Write”

Compare the **stable native data revisions** on both sides of the same conversation. Do not compare App version numbers or the modification time of the entire database file.

1. Record the previously observed and published conversation-content hash and revision information.
2. If the hash is unchanged, a changed file modification time does not count as a new revision.
3. If both sides have new revisions, select the winner using the time the conversation data was last stably written.
4. If the times match but the content differs, use a fixed rule: 1P wins. Record the selection so the content does not oscillate between sides.
5. ORG2's own copy, index registration, and recovery operations must not be recognized as new native edits. The publication record must be bound to the winning revision and the target result.

“Update” here means data write order, **not the time of the last human-authored message**. Without parsing all message semantics, it is impossible to guarantee distinguishing a new conversation from every kind of native run-state update. Acceptance must include the “open conversation only” case and record actual behavior; do not silently add another complete field allowlist to determine what is newer.

If a consistent snapshot or valid revision evidence cannot be obtained, wait or report sync failure; do not guess the winner from an incomplete file.

## 4. Sync State Rules

| Observation | Behavior |
| --- | --- |
| Content is the same on both sides | Do nothing |
| Relative to the known baseline, only one side changed | That side overwrites the other |
| Both sides changed | Select a winner under Section 3 and overwrite the other side |
| The native application is writing to the target | Wait until publication is safe, observe again, then decide |
| Any relevant revision changes during copying | Abandon this commit and observe again; do not publish a stale winner |
| The source file is compacted, rewritten, or truncated | Obtain a complete, stable conversation snapshot; do not mistake it for an ordinary append |
| The conversation is missing on one side | Import the side where it exists when ownership and index conditions are clear |
| The user deletes or archives a conversation | Do not infer overwriting or cascading deletion from a missing file; define deletion propagation separately |

Do not merge text, concatenate messages, or automatically combine two different branches. An optimization to copy only a raw delta is allowed when it can be proven that the target is a complete old prefix, but the result must be equivalent to a full-snapshot handoff.

## 5. Publication and Temporary Storage

- Write the complete new content on the target filesystem first; verify the source revision and expected target state before publishing atomically.
- Do not make an extra copy of the old file being overwritten as a backup.
- Allow only staging of required new content, necessary transaction records, and the native database's own transaction mechanism.
- After success, clean up staging files for completed transactions. Incomplete transactions need defined recovery, stale-file cleanup, and storage limits.
- Multi-file and database-index updates cannot be made atomic with a single file rename. Define how to continue committing or stop safely after interruption; do not report a partial publication as successful.
- Atomicity of file publication does not replace coordination with native writes. Defer publication if the target is still in use or the required coordination boundary cannot be established.

“No backups” means no extra copies that users can use to recover old conversations. It does not mean directly truncating a file that is in use.

## 6. Native Fork Dependencies Are Not Backups

If an old physical history file is still referenced by a native child session, frozen fork, or pending transaction, it remains valid conversation data. Do not delete or rewrite it just because the main conversation has been updated.

Codex has been observed to depend on old physical history and its index for child sessions. The new plan must preserve this native semantic: last-write-wins for a logical conversation does not mean every old physical file can be overwritten.

These necessary dependencies are not “automatic backups before overwriting” that the user rejected. Reclamation still requires proof that there are no valid references; file age, absence of a current list item, or a momentary process check cannot substitute for that proof.

## 7. Configuration Isolation and Minimal Adaptation

Accounts, credentials, plans, API endpoints, and permission settings continue to be managed by their respective environments and are not transferred when a conversation is overwritten.

Native transcripts may store prompts, tool context, and other state that affects continuation. After an as-is handoff, verify in practice that the target environment still uses its own connection and authorization settings. Do not assume that copying as-is proves routing is correct, and do not manufacture a passing result by silently discarding history content.

Prefer registering or rebuilding native directories and indexes through native interfaces. If direct database operations are required, retain only the structural adaptations and integrity checks they require, and preserve unrelated data. Do not rely on a fixed complete-database column list to determine whether every operation is supported, blindly copy unknown related tables, or discard unknown columns.

The same installation usually produces the same format, but two processes may straddle an upgrade, and the databases on both sides may not yet have completed the same migration. Hand actual structural differences to the native migration or pause the relevant operation; do not restore a design locked to release versions.

## 8. Code Change Scope

After proving the native handoff plan works, remove the following from the native sync path because they are superseded:

- Ordinary-message field allowlists and tool-name admission tables.
- Conversion logic that reserializes messages, filters message bodies, or rewrites message parent-child relationships for sync.
- Records and corresponding tests used only to explain the above conversion differences.
- Dependencies that block sync based on complete message parsing results.

Retain or consolidate: conversation identity and ownership, native discovery and indexing, necessary dependency handling, coordination with in-progress writes, content hashes, winning-revision records, atomic publication, crash recovery, resource budgets, and event-driven scheduling.

Keep the parser required for displaying transcripts in ORG2. Before deleting conversion records, handle recovery and migration of existing journals; do not directly erase incomplete operations or assume old records never existed.

## 9. Acceptance Requirements

Validate the design first in an isolated native environment, then replace the production sync path. Do not substitute manual edits to target history, fabricated directory registration, or standalone probe calls for the real product-button flow.

For each client separately, complete:

1. Configure → Open → history list appears → open history → continue conversation → automatic write-back → reopen.
2. History integrity and actual request routing in both directions: 1P → 3P and 3P → 1P.
3. Simultaneous edits on both sides: the later writer wins, the result is unique, and repeated sync does not oscillate.
4. Same content with different modification times, opening a conversation only, rapid switching, and restart.
5. Target currently being written, interrupted publication, and native-file rewrite or compaction.
6. Tool results correspond to their original calls; completed tools are not executed again when history is restored.
7. Native forks and still-referenced ancestors remain readable and continuable after overwriting.
8. Overwriting creates no old-snapshot backup; completed transactions clean up temporary files; idle operation does not repeatedly scan.
9. Native handoff still succeeds when ORG2's display parser does not support a field.

Keep manually run native-handoff, index-visibility, and continue-conversation regression tests. This PR will no longer maintain automatic downloads of the latest version, scheduled probes, or issue notifications. New fields should not themselves fail tests; distinguish actual behavior failures from inability to complete a test.

## 10. PR and Current Work Status

It is recommended to update the title and description of the unmerged PR #2103 directly, making the semantics of last-write-wins without retaining old snapshots explicit. Keep reviewable new commits; do not first merge the conversion plan that is to be removed.

The implementation has replaced the old message converter, settings-drift classification, and ordinary-field admission. Verification results and the native product flows that remain incomplete are documented in the [architecture audit](../architecture-audit-2026-09-23/native-history-compatibility.md) and the final PR. Test results from the earlier field patch and old conversion plan are not acceptance evidence for this plan.

This document does not authorize cleaning up existing user history, deleting native dependencies, merging the PR, or deploying to production.
