# Original small request remains unattributed; separate title-call reproduction

Observed 2026-09-17 during acceptance: two foreground `/model` calls produced
three settled Market requests; the third (2306 µUSD buyer) had no obvious origin.

Reproduction (2026-09-17 ~21:20Z, local acceptance Market, default `~/.claude`
home untouched, `claude -p --settings <overlay> --model <beginner alias>`):

- Session transcript contains exactly one `ai-title` record.
- Ledger shows two new requests: foreground `Coding for beginner` (buyer 47127 /
  seller 36654 / platform 10473 µUSD) and `[Acceptance] Sonnet overlap` (buyer
  2263 / seller 1760 / platform 503 µUSD), both `completed`, verified, reserve 0.
- The overlay pinned `ANTHROPIC_DEFAULT_HAIKU_MODEL` to the overlap alias, so
  the title call went to that Package even though the foreground used beginner.

The later reproduction demonstrates a separate title call on the haiku role;
it does not identify the original 2306 µUSD request. That original request
(`pr_e2bb1eb8-5c21-44b7-a04f-695b4b315a1e`) completed at
18:15:03.709Z with 2 input tokens, 34 output tokens, and 1195 one-hour cache
creation tokens. Its CLI transcript contains an `ai-title` row without a
request ID, timestamp, or usage; the original debug file was replaced by a
later resume. Its amount and ledger balance are verified, but its purpose
remains unconfirmed. Do not close that attribution item using this reproduction.

In the later reproduction, attribution follows the connection's default Package (the pinned role
aliases), not the Package chosen with `/model`. Auxiliary calls cannot be
correlated to the foreground conversation at the proxy (Claude Code uses a
different `metadata` session identity for them), so per-session routing is not
available; see tracking row 2 for the decision.
