# Human conversation submission boundaries

## Reproduced defects and authoritative sources

1. Independent cloud channel composers omitted member options, and the post hook accepted only body text even though the existing RPC accepts `mentionedUserIds`. The authoritative record is `org2_cloud.cloud_channel_messages`. The composer now resolves the exact submitted pill snapshot against the readable roster and transports stable IDs through optimistic state and the existing RPC. Private channels use their channel roster; public channels use the shared org roster coordinator. Failed roster reads refuse mention sends instead of dropping recipients. Ordinary messages remain sendable.
2. `resolveTeamChatMentionedUserIds` applied the shared audience policy's default channel visibility to notifications. A real ordinary reply created mention records for both other test accounts. The authoritative record is `org2_cloud.cloud_session_comments.mentioned_user_ids`. The notification resolver now returns no recipients without an explicit resolved mention. Shared conversation visibility and Work Item Agent routing are unchanged.
3. `insertNewline` creates a U+200B caret anchor, while `captureSnapshot` previously copied it into persisted message text. Snapshot capture now matches the editor's existing plain-text extraction semantics. A real post after pressing Enter no longer includes the anchor. ZWJ emoji and actual newlines remain intact.
4. Shared context menus offered Agent execution modes in human-only composers. The menu entry construction now omits those actions for human composers, preserving keyboard indexing and member selection.

No historical messages or notifications were deleted or rewritten. Synthetic before/after records remain available in the private acceptance evidence. Production remediation requires a separate inventory and authorization.

## Architecture coverage

| Layer                       | Evidence / decision                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation               | TypeScript typecheck and targeted tests; native rebuild for the latest develop baseline is recorded in the acceptance log                            |
| 2 Ownership and duplication | Existing audience parser, org roster coordinator, shared composer and channel RPC reused; no new polling or dispatch path                            |
| 3 Naming                    | Visibility, explicit mentions, and Agent mode are distinct concepts; no reinterpretation of the audience policy JSON                                 |
| 4 Semantic overloading      | Default channel visibility must not create explicit mention notifications                                                                            |
| 5 Defaults                  | Ordinary posts need neither a resolved roster nor implicit recipients; unresolved explicit mentions fail closed                                      |
| 6 Domain boundaries         | Human composers cannot address Agent pills or select Agent modes; no model request is dispatched                                                     |
| 7 Discoverability           | Member options come from current readable membership; removed identities are rejected before posting                                                 |
| 8 Wire                      | Existing optional recipient field only; no migration, format change, or new endpoint. Recipient arrays are copied before auth awaits                 |
| 9 Entry points              | Shared InputArea covers channel and session Team Chat menus; private/public roster paths remain scope-keyed                                          |
| 10 Resolver symmetry        | Snapshot member IDs win over duplicate/renamed labels. Typed text uses existing roster resolution. Self and removed recipients are excluded/rejected |

No Rust implementation, schema, or runtime Agent routing is changed by this patch. Rust architecture refactoring and new cloud notification storage are outside this patch.

## Remaining channel notification gap

The channel message schema stores explicit recipients, but the deployed Team Inbox mention RPC reads session comments only. Migration 0015 explicitly describes channel mention Inbox reads as future work. This patch repairs selection and durable transport, **not channel Inbox notifications**.

Completing that feature requires an additive channel-mention read/read-receipt contract, visibility checks on every read and receipt mutation, source-specific Inbox navigation, realtime invalidation, and migration tests. Private membership removal must revoke both list/detail access, and same-time pagination must use a stable message key. Session comment IDs and channel message IDs must not share an untyped read-cursor namespace. No production migration was applied during this acceptance run.

## Verification boundaries

Real desktop A/B used independent native identifiers, homes, external/native transcript roots, auth identities, and ports in an isolated test org. This proves independent-client synchronization on one machine, not two-host resource or network behavior. Raw acceptance files are private and are not committed because they include fixture credentials and original diagnostic data.

The original 164-item failure remains unresolved. Both recovered copies of the named read_file output have 11,899 characters; the 11,890-character authoritative version is missing. No whitespace/fuzzy comparison or destructive transcript repair is introduced. The editor-anchor defect above is not evidence for that historical nine-character difference.

## Executed checks

- `pnpm typecheck:fast` passed after integrating develop `8f13b1b52e`.
- `pnpm test src/features/DiscussionChannels/ChannelPanelView src/features/Org2Cloud/SessionConversation src/features/Org2Cloud/channels src/components/ComposerInput/__tests__/snapshotSubmission.test.ts src/scaffold/ContextMenu/ContextMenu.test.ts src/engines/ChatPanel/InputArea/components/ContextMenuPortal.test.ts src/engines/ChatPanel/InputArea/components/InputAreaPortals.test.ts src/engines/SessionCore/conversations/nativeConversationReconciliation.test.ts src/engines/SessionCore/sync/__tests__/nativeTranscriptReconcile.test.ts` — 44 files and 380 tests passed.
- `pnpm exec eslint <changed production and test TypeScript files> --max-warnings 0` passed, including newly added files. AST inspection found no raw action/input bypasses in changed production files.
- `git diff --check` passed.
- `CARGO_BUILD_JOBS=2 cargo build --manifest-path src-tauri/Cargo.toml --bin org2` with separate test identifiers and the shared Cargo target succeeded for A and B on `8f13b1b52e`; no Rust implementation was modified.
- Actual A/B native windows: ordinary channel messages in both directions; structured B-to-A Team Chat mention; A Inbox unread → read → original session; reverse reply; restart and read-state persistence; selected channel recipient; Enter → Send without caret-anchor pollution; post refusal restores draft, permission recovery allows retry. Cloud readbacks use three independent test identities.
- Both native databases retained only the two prerequisite session events, with zero turn intents, Agent sessions, and model-usage rows after human chat operations.

Full channel Inbox delivery, private-channel desktop membership revocation, Luna continuation, original-incident reproduction, attachment-heavy long-run performance, and two-physical-host behavior are **not** claimed as passing. Small-session idle and 2,000-event native-window measurements were collected separately; large-history WebKit footprint remains a performance investigation, not an improvement claim for this patch.
