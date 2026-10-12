# Org request contract verification

## Change and ownership

Text-only turns omit both `tools` and `tool_choice` after internal tool metadata
and selection markers are removed. Streaming and whole-response requests share
this boundary. Forced selection of a missing tool fails locally before HTTP.

`ProviderError::InvalidRequest` retains an optional HTTP status, parameter and
message. OpenAI-compatible HTTP 400 responses use this type after existing
special classifications. ReliableProvider does not repeat these requests to the
same provider; configured fallback providers remain eligible. Adaptive endpoint
and parameter repairs and side-query thinking recovery accept the new type.
Frontend conversion uses the existing UNKNOWN code with retryability false.

No database migration, task mutation, queue policy, tool permission, automatic
summary fallback or runtime dependency was added. Reverting this change restores
the previous request/retry behavior without deleting tasks or certificates.

| Contract                               | Owner                          | Proof                                               |
| -------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Empty tools omitted on both transports | Compatible request adapter     | HTTP request contract tests                         |
| Invalid forced selection never sent    | Shared tool parameter builder  | Zero HTTP requests                                  |
| HTTP 400 status/parameter retained     | Error ingestion                | JSON, text and malformed-body cases                 |
| Deterministic rejection not repeated   | Reliable provider wrapper      | Request counters and fallback case                  |
| Modified requests can recover          | Adaptive client and side query | HTTP parameter/endpoint/thinking cases              |
| Terminal summary evidence retained     | Existing Org finality          | Existing terminal/restart suites and app inspection |

Architecture review covered tool authority, wire construction, error consumers,
terminal states and persistence ownership. The routed architecture-audit skill
is absent from this checkout; no formal skill audit is claimed. UI component,
schema migration and cloud/remote topology reviews are outside this change.

## Local reproduction

Run `node scripts/dev/provider-fixture-server.cjs 18099 /tmp/provider-requests.jsonl`.
Configure an isolated app account at `http://127.0.0.1:18099/v1`, model
`local-contract-model`, using a disposable fixture token. Send
`ORG_REQUEST_CONTRACT:normal` to the default Org. The fixture scripts model
responses only; real HTTP, task tools, scheduling, SQLite and finality execute.

POST JSON `{"mode":"summary400"}` to `/control` to reject summaries;
`summary503` fails once then succeeds, `delay` allows Stop, and `strict`/`lenient`
exercise both validation policies. `/records` exposes bounded request records.
Use `FILE_REQUEST_CONTRACT` in an ordinary agent's disposable workspace to write
and read `verification.txt` through the real shell tool.

## Verification performed (2026-10-12)

The unmodified `c3480fcf3` baseline BuildFast app sent both `tools: []` and
`tool_choice: "auto"` for its final report. A strict loopback service returned
HTTP 400 eleven times before the report failed. Independent HTTP-boundary tests
against that baseline also failed for both streaming and whole responses.

The repaired BuildFast app used an isolated profile and the same loopback
service. The Org coordinator created a task, a member completed it through
`task_update`, and `org_run_complete` produced a certificate. The final report
request omitted both tool fields and persisted once. A lenient service also
completed. A forced summary HTTP 400 produced one request and one failed
receipt. A temporary HTTP 503 produced two requests (503, then 200) and a
persisted report. Stopping a delayed report cancelled its HTTP request and
recorded a stopped receipt. The existing retry button created exactly one new
attempt for the same certificate and persisted it. Quitting and reopening the
packaged app preserved the session, task outputs and receipts without issuing a
new report request. An ordinary agent wrote and read `verification.txt` using
the real shell tool.

Three normal / invalid-parameter / transient-recovery sequences were exercised.
In the second recovery, the scripted fixture returned a generic text response
while the Org reported transient in-flight blockers, so completion required a
new user message. This limits what the scripted run proves and is not counted
as automatic completion. The first and third sequences completed without that
prompt. The Command+5 diagnostics panel showed no recorded API calls; HTTP
records and read-only SQLite queries provide the request and persistence
evidence instead.

An additional fresh-session repeat reproduced a separate acceptance gap under
the fixture's near-instant responses: after a successful report and one 400
failure, the next member task completed, but the Org stayed running with no
certificate or final report for over three minutes. Its Coordinator turn ended
as `waiting_for_org_event`; two subsequent resume intents were cancelled. The
user message was marked answered, so this is an Org wake/finality gap rather
than a message left in the sending state. The cause of the cancelled wakes is
not proven. Queue and background mechanism changes are outside this patch;
repeated automatic recovery is therefore **not fully accepted** locally. The
user chose to deliver this request fix and handle the wake/finality gap in a
separate task.

Automated checks: 3,772 Rust library tests passed (4 ignored); Clippy with
warnings denied, repository lint, circular-import check, 31 selected frontend
tests, the fixture tests and `git diff --check` passed. The company services and
Windows incident database are unavailable locally and are not claimed as
tested. Company testing is deferred to the user and is not a local gate.

| Performance area       | Verdict | Evidence                                                                      | Change or reason kept                                                      | Verification                                                          |
| ---------------------- | ------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Background work        | Keep    | No new timer or poller; retry is request-scoped                               | Invalid requests exit immediately; transient failures retain bounded retry | One 400 request, two 503 requests, no idle requests after two minutes |
| Memory                 | Keep    | No new retained production collection                                         | Tool parameters are allocated once per request                             | 121 MB in foreground and hidden idle samples after repeated runs      |
| Scope and isolation    | Keep    | BuildFast instance 99 used separate data and external-history homes and ports | No cache or identity changes                                               | Restart preserved only the isolated test session                      |
| Rendering and hot path | Keep    | No UI or per-delta parser change                                              | Shared helper runs once before HTTP                                        | Full Rust suite and foreground/hidden CPU samples                     |

Performance verdict: pass for the changed provider path. Foreground idle was
0.0% CPU and hidden idle 0.7% CPU in point samples; an earlier active
conversation sample was 7.4%. These samples do not establish a long-term memory
trend or make a claim about company services. After shutdown, the isolated app
and test server processes were gone.
