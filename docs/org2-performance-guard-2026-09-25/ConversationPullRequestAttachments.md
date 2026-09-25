# Explicit conversation pull request attachments

## Source and root cause

The conversation's authoritative PR association is Codex's `thread_attachments` table, scoped by the thread identifier in its rollout header. The first implementation looked up the current branch only; attached PRs can have different head branches and therefore disappeared despite being explicitly associated with the conversation. The revised reader follows the rollout's own provider home and reads only `pull_request` attachments. It does not scrape assistant text, infer links from tool logs, or mutate provider data.

The production reader was exercised against the current conversation by the backend implementation agent and returned PRs **2153 and 2152**. The frontend regression fixture uses those URL identities with synthetic metadata and distinct head branches; the fixture proves projection and lifecycle, not a live GitHub UI session.

| Area               | Verdict | Evidence                                                                                                       | Change or reason kept                                                                                                                             | Verification                                                         |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Background work    | keep    | Native reader runs blocking file/SQLite work through `spawn_blocking`; hook has no polling                     | Read bounded rollout header and at most 100 explicit attachments on demand                                                                        | Backend reader coverage and hook hidden-start test                   |
| Background work    | fix     | Metadata fanout can outlive a hidden or switched surface                                                       | Three workers; cancellation stops dequeuing and prevents a failed pending request starting fallback work after hide                               | Hidden queue, fallback-after-hide, and unmount regressions           |
| Memory             | keep    | At most 100 canonical URLs and three active metadata workers per hook; existing shared metadata cache retained | No new application-lifetime metadata cache                                                                                                        | Bounded fanout and duplicate URL regression                          |
| Scope/isolation    | fix     | Current checkout branch is not the conversation's attachment identity                                          | Resolve thread ID from rollout metadata, provider DB from that rollout's own home; frontend hides old session results and ignores late completion | Backend provider-home tests; old-session late-response regression    |
| Rendering/hot path | keep    | One row per canonical PR URL, plus existing branch fallback if distinct                                        | Keep explicit URL actionable if GitHub metadata fails; retry refreshes                                                                            | Multiple/different-branch rows, canonical dedup, failure/retry tests |

## Independent verification

`pnpm test src/scaffold/AppLayout/FocusedChatWorkstationRail/useSessionPullRequests.test.ts`: **8 cases passed**:

- Two explicit PR URLs remain present with different head branches; duplicate and invalid URLs are excluded.
- Hidden mount defers reads and resumes on visibility return.
- Delayed previous-session results cannot replace the current conversation.
- Only three metadata requests run concurrently; hiding stops further dequeue.
- A failed request after hiding cannot start a metadata fallback.
- Unmount prevents subsequent metadata loading.
- Metadata failure preserves the URL and retry requests fresh metadata.
- Attachment-reader refresh failure preserves prior rows; caller revision triggers a new read.

## Live verification limitation

Native ORG2 Dev was running on its local backend port, but the current computer-use inventory exposed neither its window nor an in-app browser. Selecting its known app identifier and exact running executable returned `Invalid app`; creating an in-app browser returned `Browser is not available`. No alternate automation bypass was used, and no fresh native UI screenshot or native rendering success is claimed. Previous component screenshots predate this attachment-source correction and cannot prove it.

No CPU/RSS, live account-switch, or secondary-instance measurement was performed. The existing shared head-check cache is keyed by repository/PR rather than credentials; its account-switch behavior was not changed or verified in this patch. Explicit provider attachment reads are isolated to the rollout's provider home.

**Performance verdict: blocked** for complete native measurement and live credential isolation. Scoped reader/hook lifecycle checks pass; this report does not claim full native end-to-end verification.
