# Failed-message "Retry" on the final build — 2026-09-17 22:21–22:27Z (corrected)

Build `f006d33b6` (overlay), Instance 89, canonical conversation
"Reply exactly PACKAGE-FINAL-F1-CC-BEGINNER-OK…" (root `cliagent-…066526`,
execution child `cliagent-…228377`).

1. Failure injection: the local Market gateway (127.0.0.1:8937) was stopped and
   `Reply exactly PACKAGE-RETRY-GATE-OK. Do not use tools.` was sent from the
   composer. Claude Code retried the refused connection for 3 minutes; to get a
   terminal failure the gateway was restarted with a wrong signing key, after
   which the view showed `API Error: 502 Failed to connect to upstream provider …`
   and the child intent `00e5aa92` was recorded `failed` (22:24:47Z). No Market
   request, nothing charged.
2. Recovery: gateway restarted with its captured environment (correct key).
3. Resend on the tail failed message (pencil → **Resend**). **This did not take
   the failed-intent retry path.** The row was the landed child user row
   (`runlanded-…`, no `syntheticUserInput`), so `useEditUserMessage` ran its
   edit/rewind branch against the ROOT: `cli_agent_truncate_after_chunk(root)`
   (log: `file-history rewind … restored=0 deleted=0`), root store evicted
   without reload, then a direct `cli_agent_message(root)` (log:
   `dispatching rerun session_id=<root>`) — a fresh provider conversation (new
   native transcript `ccb32190…`, root intent `0754bb45` completed 22:26:52Z,
   reply `PACKAGE-RETRY-GATE-OK`). No pre-existing native history file lost rows
   (checked against the pre-Resend snapshot; only the child transcript grew).
4. Ledger: one foreground request (`Coding for beginner`, buyer 48278 µUSD) plus
   the automatic title call (382 µUSD, same package: embedded sessions pin every
   role to the session's package).
5. Symptom the user saw ("looks stuck, no planning footer"): because the rerun
   ran on the root outside the durable queue, no runner/delivery was registered,
   so the conversation surface had no scope for the "Agent working" footer and
   did not render the reply until the session was reopened.

Verdict: the *canonical-root Resend* path is a product bug (tracking row 12;
diagnosis: `docs/market-package-final-delivery/evidence/resend-diagnosis.md`),
fix in progress in this branch. The queue-only failed-intent Retry path (the one
Codex verified on `eb242`) was not exercised here.
