# b02d runtime regression — 2026-09-18

Runtime: immutable `b02d41a5e4`, isolated ORG2 test root. The user completed
Keychain authorization; Package loading then succeeded. No credentials or
historical conversations were copied to create these tests.

## Real Codex CLI calls and cache accounting

Two calls through Coding for beginner / Terra completed in one ORG2 conversation.
The first stored a marker and returned `READY`; the second recalled the marker
without its value appearing in the new prompt.

| Turn UTC | Upstream input, inclusive | Cached input | Output | Buyer / seller / platform µUSD |
| -------- | ------------------------: | -----------: | -----: | -----------------------------: |
| 14:45    |                      9588 |            0 |      5 |             8656 / 6733 / 1923 |
| 14:46    |                      9660 |         8704 |      9 |              1692 / 1316 / 376 |

Market settlement independently matches the frozen administrator percentages
(45% buyer, 35% seller), cache prices and rounding. Both reserves are zero;
historical requests and postings remain unchanged.

The cache hit uncovered an additional native statistics defect: Codex CLI's
app-server parser persisted inclusive input alongside cache reads, while usage
consumers treat input as uncached. The second row therefore stored 9660 plus
8704 instead of 956 plus 8704. Market charged correctly; ORG2 usage statistics
must not be reported as passing. Historical rows are retained as evidence.

A separate SDE / diagnostics Terra call returned its expected marker. Three
auxiliary requests had real cache reads of 3584, 3584 and 4608 tokens. SDE
persisted uncached inputs of 1028, 1153 and 526 respectively; adding each cache
read reconstructs the upstream inclusive input. Thus the existing Responses
parser correction is verified for these reads; the CLI adapter remains a
separate failing boundary. Cache writes were zero and are not verified here.

All six SDE-window requests reconcile to buyer/seller/platform totals of
35853/22817/13036 µUSD at that Package's frozen 55%/35% administrator settings,
with every new reserve cleared. Native receipt IDs
identify one foreground call, one session-title call and four workspace-memory
calls; their usage matches the corresponding Market requests. These new
correlations do not establish the purpose of the historical 2306 µUSD request.

## Controlled failure and Retry

After both requests completed, only the named local acceptance gateway was
gracefully stopped. A third turn genuinely failed to connect. The gateway was
then restarted from its original configuration; health and readiness returned
200, and the protected historical request remained unchanged.

The failed turn exposed two further gaps: a resumed Codex stream repeated the
preceding usage row, and the conversation path published an ordinary error while removing
delivery ownership. Later raw-event tracing on `2441` identified a shared
settled-tail lifecycle classification defect; the personal session scope and local continuation log
do not alone prove which conversation authority handled the turn. The rendered message had no Retry
button. `Replay turn` opened the timeline; it did not execute another request.
This is a failed acceptance gate, not a successful Retry. Fixes and another
immutable-build run are required.

## Configuration lifecycle

Claude Code CLI's product Configure → Use connection → Disconnect returned to
Original setup. All 44 protected primary file existence/hash checks remained
unchanged. This run did not launch or restart the external CLI.

Official Codex remained protected by a configuration conflict. Read-only
inspection showed normal vendor changes: selecting another committed Package
model, reasoning effort, desktop preferences and workspace trust. The additional
source fix verifies model membership against the unchanged owned catalog while
retaining strict provider/address/catalog checks. Its 83 managed-configuration
tests and Clippy passed; this does not replace native reopen/Restore acceptance.

The official Codex window cannot be operated by the computer-use tool. Normal
exit and subsequent GUI acceptance require user operation. The primary Codex
process and live managed files have not been changed to manufacture a pass.

## Resource observation

Four samples over 15 seconds measured the ORG2 process and its verified WebKit
services after the calls, with the window open and idle. CPU intervals were
0.03%, 0.03%, 0.02% of one core; combined physical footprint was
485.91–485.97 MiB. Foreground status was not independently established. This
short sample excludes external CLI processes and does not establish hidden,
active, long-duration or post-close behavior of a future build.

## Source correction and focused validation

The follow-up fixes keep Cloud's original queue owner for an explicitly retried,
proved empty native failure. Partial replies, tools, private reasoning and
cancellation cannot qualify. Local durable lineage preserves audit history; a
missing acceptance/finish response recovers the same intent instead of issuing
a second provider call. No new polling or automatic inference retry was added;
the existing lineage bound remains 64 attempts. Cross-device proof and context
reduction are not claimed.

Codex exec and app-server adapters now store uncached input separately from
cache reads. App-server accepts usage only for its active thread/turn, avoiding
stale usage on failed resumed turns. No historical usage rows are rewritten.

Before target-branch integration, focused source checks passed:

- 12 related Vitest suites: 276 tests, including failure recovery, materialization
  and malformed/partial-output negative cases
- `pnpm typecheck:fast`; changed TypeScript files passed ESLint with zero warnings
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib agent_sessions::cli::parsers:: -- --test-threads=2`: 212 passed, 5 existing ignored
- 83 managed-configuration tests, including valid vendor changes and strict
  provider/catalog conflict negatives
- Clippy for `org2` and `agent_cli` libraries/tests with `-D warnings`
- `git diff --check`

These are source-level checks. The new immutable artifact still needs real
cache-hit, successful original Retry and official Codex Restore acceptance.
