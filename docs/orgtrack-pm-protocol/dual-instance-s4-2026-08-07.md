# Two-Instance Live Verification — S4 Tool Retirement (PR #737, 2026-08-07)

This records live S4 verification under the two-instance protocol (`.orgii/skills/dual-instance-verification/SKILL.md`): removal of typed tools and adoption of the `org2-pm` CLI as the sole agent entry point. Sender instance-1 was a debug build of this branch (webdriver feature, real `~/.orgii`); receiver instance-2 was the older, untouched ORGII-instance2 build.

## Cell results

| Cell | Scenario | Result |
| --- | --- | --- |
| A | Filler through CLI: real Create-with-AI UI and a real deepseek-v4-flash LLM turn (wdio, isolated live home). | **GREEN** (13.3s). Transcript: `work show --standalone` → `work update --title … --body …` → `work show` verification; all exit codes 0. Stored title and body matched exactly. Audit sequence: `work.create → work.patch(app) → work.patch:agent:os`. Session row: `org=bfa7b134 / build / project`. |
| B | Two-instance collaboration sync: CLI writes to shared org “CU New Target 0720” across processes. | **GREEN**. `WI-0013` CLI create+update → workitems persisted → outbox row → watermark (2s poller) → `orgii-data-changed` → forceProjects → cloud `cloud_work_items` row (rev2 title, two writes coalesced) → instance-2 pulls locally. An expired JWT briefly blocked the flow (multiple GoTrue clients racing) and recovered on its own. When both windows lost focus, neither pushed nor pulled under the minimize-aware design; foregrounding them completed the flow immediately. |
| C | Subagent root walk: real `builtin:general` delegation runs `org2-pm context`. | **GREEN**. Envelope `sessionRef` was the top-level parent session, exit 0. Three C-lite identity cases (matching identity / child-session environment impersonation / human impersonation) produced OK / PERMISSION_DENIED / PERMISSION_DENIED. |
| D | Fleet ledger (`cloud_sessions` full set grew from 1365 to 1368 rows). | Boot 1 produced a full claudecodeapp epoch+1 wave for org bfa7b134 and resurrected two rows by changing `deleted_at→None`. The deterministic boot-2 cell had **zero inserts/deletes and zero epoch changes**. Only this session transcript and one active Codex session grew monotonically. Classified as a one-time upgrade reanchoring caused by serialization differences between the old 0829a9b build and develop+#737. |
| E | Destructive-verb audit across both instances' boot-window logs. | Clean: only benign disabled-tool skip logs and two temporary scratchpad housekeeping hits. |

## Findings from live testing, all fixed in #737

1. **Ask/Plan denied shell access, so the filler could not fill.** The agent searched for `run_shell` 15 times and stopped. This exposed the unresolved assumption that WorkItem mutation implied shell access. Fix: pin filler and Create-Project-with-AI launches to `agentExecMode:"build"` (`97f67fa3e`).
2. **The filler session lacked an org, so `ORGII_ORG` was not injected and the CLI could not find org-standalone drafts.** Fix: carry `orgId` in the top-level launch (same commit).
3. **The standalone allocator counted within an org while IDs were globally unique.** On the real home, `WI-0001` collided across orgs and the S0 create guard rejected it; old code would silently overwrite the other org's item. Fix: skip globally occupied IDs (`202185e6a`).
4. **The actor was empty in standalone patch audit records.** Fix: carry the actor through `update_standalone_work_item_atomic_by` (`09a8e8b9a`).
5. Fix three E2E spec issues: a dead selector after Harry's launchpad redesign, org-aware scan and jitter stabilization, and registration of the `readProjectOrgs` helper (`97f67fa3e` and `835d6cf19`).

## Additional finding (evening of 2026-08-07, user's machine, bundled build)

**P0 — `org2-pm` was absent from the bundle.** `externalBin: []`; the `.app` contained only the main binary. PATH was prepended with the executable directory, but no CLI was there, leaving agents in the packaged build without a work-system entry point after typed-tool retirement. The live green results had run from a debug build where the binaries happened to share a directory. Fix: include `org2-pm` as a version-locked `externalBin` sidecar, distinct from the policy for sidecars downloaded on first launch. Wire `prepare-sidecars.cjs` into tauri:dev, tauri:build, fast-build, and release CI on three platforms. Rechecking the fast-build bundle showed that `Contents/MacOS/org2-pm context` returned a valid envelope.

## Open items outside this PR

- **Session-memory side query hardcodes claude-haiku-4.5.** Extraction fails and shows a toast when an account lacks that model. A task was filed to fall back to an available account model.
- **`gemini_cli` is absent from `CliAgentTypeSchema`.** Sidebar pagination over June gemini_cli sessions fails RPC output validation. A background task was filed.
- **No local tombstone after cloud deletion allows resurrection during upgrade push.** Boot 1 resurrected two rows deleted in cloud at 16:49Z that day by reasserting still-present local rows on a full re-push. This is the known inability to prove absence without a tombstone, not caused by #737; upgrade reanchoring merely exposed it during the #737 window.
- **Projects-channel recovery from expired JWT is slow.** Multiple GoTrueClient warnings and up to roughly one refresh interval without pushes followed expiry. It self-healed but should be covered by single-owner token cleanup.
- **Uncovered:** Visual assertion for rendered S3 envelope card state (store and transcript were verified, no screenshot); real scheduling trigger for `--schedule-cron` was not run.

## Sub-item and Discussion live verification (late 2026-08-07, user's machine, real Opus)

Three rounds implemented and tested sub-item and Discussion behavior: `--parent`/`--stage`, “Post exactly ONE comment per run,” turn-end fallback, and mention side-effect discipline.

- **Mechanics:** Add `work create --parent`, `work note --standalone`, and `work list --standalone`. CLI E2E covers parent linking and notes appearing as comments.
- **Discipline:** Restore the splitting criterion in the CLI brief (“more than one independently completable step”), require exactly one outcome receipt rather than a process log, and support blocked transitions. Linked-work-item context adds a prominent delivery requirement: “Chat replies are conversation, not delivery.”
- **Live rounds:** WI-0016, without the delivery requirement, produced complete agent output only in chat and made zero CLI calls. After the requirement, WI-0017 filled a 381-character body and posted exactly one `[progress]` receipt, verified in Discussion UI. WI-0018 **autonomously split into three sub-items** (WI-0019/20/21, each 600–900 characters, eight audit entries all marked agent:os), closed with a parent overview, and posted exactly one receipt.
- **Filed gap:** The detail page lacks a Sub-items section. The parent relationship exists only in storage, so the agent can only write references manually in the parent body.

## Probe cleanup

`WI-0013` received a cloud tombstone (v2, `deleted_at` 2026-08-07T20:50:30Z); both instances converged on deletion after pulling (see task log). Disposable isolated E2E home and wdio shard homes were removed. Real-machine demonstration data `WI-0015` (rail probe) and `WI-0017`–`WI-0021` (discipline probes in org bfa7b134) remain for the user to inspect and remove at their discretion.
