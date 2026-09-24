# Native connections: operation checks and raw history handoff

App version numbers and local installation generations are diagnostic, not compatibility
allowlists. `ADAPTER_REVISION` and the shipped permission/evidence catalog are
removed. The [raw last-write-wins contract](design/native-history-last-write-wins.zh-CN.md)
defines history behavior; it supersedes the earlier message projection and
settings-only drift design.

## Product and authority boundaries

The website manages purchases, API keys and budgets. Existing App connection
cards configure and open the selected native client. History synchronization
is event driven; there is no Session Sync page or browser-confirmation dependency.

Configure, catalog discovery, bootstrap, Open and history resolve one selected
installation. File and directory metadata identities invalidate stale observations
when it changes, including replacement while an older process remains running.
Unknown, missing and non-semantic version labels do not themselves deny access.

| Operation     | Actual contract                                                                                                     | Failure scope                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Configure     | Current owner, purchase, managed paths, configuration and selected model                                            | Refuse that transaction                                         |
| Codex catalog | Selected runtime returns bounded model metadata in an empty offline home                                            | Report catalog failure                                          |
| Open          | Selected profile, proxy, executable and process identity; Codex's actual bundled core                               | Preserve uncertain launch intent; do not create a second writer |
| History       | Session ownership, stable raw revision, destination configuration, necessary native indexes and writer coordination | Wait or pause the affected publication                          |
| Return route  | Explicit destination configuration, otherwise a bounded native default observation                                  | Do not borrow a package's default for the primary environment   |

Native process/environment binding is not proof of OS confinement or a successful
provider request. Original account credentials and connection configuration never
move with a conversation.

## Raw last-write-wins behavior

Ordinary message fields and tool names are opaque to synchronization. JSONL framing,
session identity, raw hashes and required native index relationships still matter.
The ORG2 display parser can report unsupported preview content without deciding
whether native handoff is allowed.

An unchanged content hash is not a new edit, even if its modification time changes.
A single changed side wins; when both sides changed, stable native revision time
orders them, with primary winning an exact tie. Claude uses stable transcript mtime;
Codex uses stable rollout mtime for raw changes and the thread update clock for
metadata-only changes, never whole-database mtime. On first observation or changes
to both raw content and metadata, it uses the later of the two valid clocks. This is data-write ordering, not
the time of the last human message: merely opening an old conversation can append
native state and make it the later revision. Unique content on the losing side
can be overwritten without a recovery copy. No message merge or branch splice is
performed.

Publication receipts bind the winning revision and the actual destination result,
so ORG2's copy, index update and destination routing setup cannot bounce back as
new native edits. Source rewrites/compaction are full stable snapshots. Missing
files do not imply user deletion or permission for cascading deletion.

Prepare new content on the destination filesystem; revalidate the source,
destination, owner and configuration before publication. Required file/SQL updates
use durable recovery state; one successful rename is not a complete multi-resource
commit. Temporary new-content artifacts are cleaned after durable completion.
The new path does not create old-history backups. Earlier backup files are retained;
this change does not authorize cleaning existing user history.

## Native-specific boundaries

Claude uses the namespace registered by the official App. ORG2 does not manufacture
installation or organization IDs. Namespace discovery and transcript/catalog
import use the coordinator and its writer-closed checks. A newly created namespace does not prove that the first window has loaded
existing history. First-window acceptance remains separate.

Codex retains immutable raw generations and index projections needed by frozen
children. A logical last-write-wins decision does not permit rewriting or deleting
a referenced physical ancestor. Native `thread/fork` and raw-path reads can bypass
the parent's writer lock. The [retention design](design/codex-history-retention.md)
explains why safe automatic ancestor reclamation remains unimplemented. More
frequent raw-state writes can retain more generations; the 4,096-entry bound
pauses work rather than reclaiming unproven ancestors.

Codex resumes an imported thread with the package alias but runs its pre-turn
context compaction with the thread's previous vendor model name. The managed
proxy applies a compatibility policy for the `codex` app source only: a request
model that is not a configured package alias and has a bare vendor-model shape
routes to the user's configured default package, also when several packages are
configured; explicit package aliases still resolve strictly, stale aliases are
rejected, and Claude app sources are unchanged. This is a policy, not a proof that
such names only come from history, and it does not by itself verify end-to-end
routing or billing of the compaction request.

The launch reservation distinguishes an unobserved dispatcher result from an
observed GUI process. Once the selected profile's GUI is observed, its PID and
kernel start time are persisted alongside the boot UUID before runtime binding
is checked. A later Open can retry after that exact process lifetime has ended
and a fresh profile scan finds no replacement to reuse. Live or unreadable
processes and never-observed dispatches remain blocked; no background timer or
process termination is added. Successful binding clears the reservation as before.

Existing boot-only reservations remain readable and conservative: without an
observed identity, retry still requires observing the running app or a new boot.
The optional `observed-v1` record is bounded to 256 bytes; malformed/partial writes
fail closed. Older binaries reject the extended record rather than launching a
second writer. Before rolling back, complete a successful Open with the new
binary to clear the record, then quit the native app normally. Do not truncate a
live or uncertain reservation to bypass protection. Recovery of an observed
failed launch is covered by deterministic lifecycle/kernel tests; real GUI
acceptance of this new recovery path is still required.

An indexed native roster can be unique while file-discovery fallback lists retained
generations more than once. That vendor behavior is not hidden by UI filtering or
ancestor deletion. Cloud/fallback acceptance must be reported separately.

Only the native tables/columns and relationships needed for a publication are
adapted. Unknown ordinary message fields are preserved. Actual incompatible SQL
relationships, triggers or migrations may pause the affected operation; a release
number does not decide the result.

Claude receipts/publication journals use format 3; verified format-2 baselines
migrate with independent accepted hashes, without labeling old projected
differences as new native edits. A legacy registration-format-1 transaction
pauses with its artifacts intact. Codex uses journal format 4 and SQL snapshot
format 2; older journal/snapshot readers remain for proven recovery. Additional
compatible SQL columns participate in hashes, snapshots and writes. Actual
source/target table-contract differences pause publication.

Unknown or ambiguous pending transactions remain intact. A stale choice can be
cancelled before publication when current state and staged ownership are proven;
partially published multi-resource Codex transactions finish from their recorded
snapshot before accepting another revision. Rollback must understand the new
journal format or pause synchronization; deleting journals, native files or
ancestors is not a recovery procedure.

## Manual native regression checks

Native fixtures remain opt-in developer tests. This PR removes the dedicated
Claude/Codex canary workflows, release downloaders and issue notifications;
ordinary build, unit-test and PR-policy CI remain unchanged. There is no scheduled
upstream compatibility monitoring after this change.

Claude's ignored Rust tests run the supplied official CLI against disposable
profiles and loopback providers, then use the production Rust storage bridge for
raw handoff and native resume. Set `ORG2_CLAUDE_CLI` to an installed CLI and run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked native_offline_ -- --ignored --nocapture --test-threads=1
```

Codex's `codex_history_native_probe.py` runs the official bundled core through
disposable profiles and the production engine example. Its required command-line
arguments and cases are documented by `--help`; build the engine first:

```sh
cargo build --manifest-path src-tauri/Cargo.toml -p agent_cli --example codex_history_probe --locked
python3 src-tauri/crates/agent-cli/examples/codex_history_native_probe.py --help
python3 src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_process.test.py
```

Record the source revision, installed native version, binary hashes, case output
and process cleanup alongside results. No downloaded release, parsing-only check,
or previous success substitutes for actually running a native fixture. These
checks do not certify the desktop Configure/Open flow or provider accounting.

## Acceptance

Each client must independently complete normal Configure → Open → visible history
→ continuation → automatic writeback → reopen. Also exercise simultaneous edits,
mtime-only changes, view-only opening, source rewrites, busy writers, interrupted
publication, native forks and completed tools without replay. Unit tests, native
RPC/CLI tests and GUI evidence are separate matrix cells.

Use synthetic sources and let the product create managed targets. Do not seed a
target or call a standalone reconciler to claim the product flow passed. Record
the exercised source/binary identity and preserve failures. A GUI tool refusal
must not be bypassed. Paid-provider routing/accounting remains a separate check.

Current test results and explicit outstanding acceptance are recorded in the PR
and [architecture audit](architecture-audit-2026-09-23/native-history-compatibility.md).
No merge, production deployment or existing-history deletion is implied.
