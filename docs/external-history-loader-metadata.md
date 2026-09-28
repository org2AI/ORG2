# External history loader metadata matrix

This document records the metadata that ORGII reads from external AI session loaders and writes to the unified cache. Use it to determine whether a loader supports file → AI session blame, distinguish absent source data from data not yet normalized by a loader, and keep the capability matrix current when a loader changes.

Last verified against code: **2026-07-14**.

## Scope

This covers the eight external loaders then registered in `imported_history`: Claude Code (`claude_code`), Codex (`codex_app`), Cursor (`cursor_ide`), OpenCode (`opencode`), Windsurf (`windsurf`), WorkBuddy/CodeBuddy (`workbuddy`), Trae (`trae`), and Cline (`cline`). `orgii_cli_sessions` and `orgii_rust_agents` are ORGII-owned session sources, so they are outside this matrix.

## Unified cache schema

Every loader ultimately writes `ImportedHistoryCacheInput` / `imported_history_session_cache`.

| Category | Fields |
| --- | --- |
| Identity | `source`, `source_session_id`, `session_id` |
| Source/change detection | `source_path`, `source_record_key`, `source_mtime_ms`, `source_size_bytes`, `source_fingerprint`, `parser_version` |
| Session | `name`, `created_at_ms`, `updated_at_ms`, `model`, `input_tokens`, `output_tokens`, `repo_path`, `branch` |
| Impact/hierarchy | `files_changed`, `lines_added`, `lines_removed`, `touched_files`, `listable`, `parent_session_id`, `source_metadata_json` |

The unified cache currently has no recorded-cost, estimated-cost, commit, or pull-request field. Price estimation is downstream computation, not raw loader metadata.

## Capability matrix

Legend: ✅ written by the loader; ◐ written with limited meaning or precision; 🟡 derivable from source transcript/tool data but not written by the loader; ❓ product capability exists, but no stable mapping from the local store has been verified; — no reliable source or unsupported.

All loaders write a session ID, name, creation/update times, and source provenance. This table compares only capabilities that differ.

| Loader | Repo path | Branch | Model | Token split | Touched files | `+/-` lines | Parent/subagent | Source-specific metadata |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | ✅ `cwd` | ✅ `gitBranch` | ✅ | ✅ input/output; input includes cache tokens | ✅ | ✅ structured patch; heuristic fallback for old records | ✅ sidechain → parent | — |
| Codex | ✅ turn `cwd` | — | ✅ | ✅ input/output | ✅ | ✅ successful `patch_apply_end` | ✅ subagent thread → parent | — |
| Cursor | ✅ tracked repo/workspace | ✅ tracked branch | ✅ | ◐ single `contextTokensUsed` stored as input | ✅ `originalFileStates` | ✅ Cursor summary counts | ✅ composer child → parent | ✅ status, agentic, mode |
| OpenCode | ✅ `session.directory` | — | ✅ | ✅ reasoning/cache token categories included | ✅ edit tool parts | ◐ heuristic tool arguments/diff | ✅ `parent_id` child → parent | — |
| Windsurf | ✅ tracked repo/workspace | ✅ tracked branch | ✅ | ◐ single context token total stored as input | ✅ tool-former edit data | ◐ heuristic tool arguments/diff | ✅ `subagentInfo` child → parent | — |
| WorkBuddy | ✅ `cwd`/`project` | ✅ `gitBranch` | ✅ | ✅ input/output including cache tokens | ✅ edit tool arguments | ◐ heuristic edit-argument counts | ✅ subagent path → parent | — |
| Trae | ◐ reconstructed from project slug | — | ◐ agent label, not the LLM model | — | — | — | — | ✅ agent, current, order |
| Cline | ✅ `workspaceRoot`/`cwd` | — | ✅ model, provider fallback | ✅ input/output | ✅ child/root edit transcript | ◐ heuristic old/new tool arguments | ✅ `sessions.db` child → parent | — |

## Direct versus loader-derived metadata

“Direct” means the source store has a stable field or structured map that the loader only reads, renames, or prefixes with a session ID. “Computed” means the source lacks the final session-level cache field, so ORGII traverses events or tool records and filters, aggregates, or parses diffs. “Heuristic” means the inputs are requested tool arguments, which may not match what was successfully written to disk.

### AI blame and subagent provenance

| Loader | `touched_files` source | `lines_added/removed` source | Parent/subagent source |
| --- | --- | --- | --- |
| Claude Code | **Structured computation:** aggregate `toolUseResult.filePath`; aggregate Edit/MultiEdit/Write paths for old records | **Structured computation:** count `structuredPatch`; old records use an old/new-argument heuristic | **Direct metadata:** `isSidechain` and parent `sessionId` |
| Codex | **Direct structured event:** map keys in successful `patch_apply_end.changes` | **Structured computation:** parse each change's `unified_diff` | **Direct metadata:** `parent_thread_id` / thread-spawn parent |
| Cursor | **Direct metadata with filter:** `originalFileStates` map keys | **Direct metadata:** `totalLinesAdded` / `totalLinesRemoved` | **Direct metadata:** `subagentComposerIds` and `parentComposerId` |
| OpenCode | **Computed:** filter this session's write/edit/patch parts and aggregate input paths | **Computed/heuristic:** parse patch diff if available; otherwise count old/new/content tool arguments | **Direct metadata:** `session.parent_id`; loader checks cycles and orphans |
| Windsurf | **Computed:** filter this composer's edit/write tool-former records and aggregate parameter paths | **Computed/heuristic:** parse patch or compare before/after content | **Direct metadata:** `subagentInfo.parentComposerId` |
| WorkBuddy | **Computed:** aggregate paths from child/root JSONL edit/write/apply-patch calls | **Heuristic computation:** count old/new/content/edits tool arguments | **Path-derived:** `<parent>/subagents/agent-*.jsonl`; child ID is direct |
| Trae | **No reliable source** | **No reliable source** | **No reliable source** |
| Cline | **Computed:** aggregate `editor.path` in each DB row's own transcript | **Heuristic computation:** count `old_text` / `new_text`; exclude failed results | **Direct DB metadata:** `is_subagent` and `parent_session_id` |

Only Cursor already provides both file and line summaries in session/composer metadata. Codex provides an authoritative applied-event file map but still needs diff parsing for line counts. Claude Code has authoritative structured patches, but tool results must be aggregated across the session. OpenCode, Windsurf, WorkBuddy, and Cline lack a ready session-level touched-file list and require loader computation from their tool records.

### General session metadata provenance

| Loader | Present directly in source | ORGII computation/normalization | Heuristic or missing |
| --- | --- | --- | --- |
| Claude Code | Session ID, timestamp, `cwd`, `gitBranch`, model, usage, title/summary, sidechain fields | Title fallback chain, token-category sums, turn/tool-record aggregation | Line totals for old edit records |
| Codex | Thread ID, timestamp, turn `cwd`/model, `total_token_usage`, parent thread, patch result | Title fallback chain, latest-total-usage selection, patch-diff aggregation | Branch missing; old rollouts use tool-call fallback |
| Cursor | Composer name/time/status/model/mode, context token total, repo/branch, impact totals, subagent fields | Workspace fallback, URI → path, filter file states with real edit markers | Input/output token split missing |
| OpenCode | `session` table ID/title/directory/model/times/token columns/`parent_id`, plus part tool state | Parse model JSON, sum reasoning/cache categories, aggregate part impact, check container/mirror | Line totals use tool arguments when no patch exists |
| Windsurf | Composer name/time/status/model/context total/repo/branch, `subagentInfo`, bubble tool-former data | Workspace fallback, normalize tool params/results, aggregate composer impact | Input/output split missing; line totals heuristic without diff |
| WorkBuddy | JSONL timestamp/model/usage/`cwd`/project/branch, embedded child `sessionId` | Title fallback, several token-field formats and sums, tool-impact aggregation, parent derived from directory layout | Line totals use requested-argument heuristic |
| Trae | Summary topic/time, agent ID, current/order | Best-effort repo path from project slug; agent ID to display label | Model/tokens/branch/impact/parent missing |
| Cline | DB session/parent/status/time/model/workspace/messages path, sidecar title/prompt/usage, transcript events | DB → sidecar → transcript fallbacks, aggregate-usage fallback, impact per root/child transcript | Branch missing; line totals use editor-argument heuristic |

## Loader details

### Claude Code

Main source: `~/.claude/projects/**/*.jsonl`, plus the adjacent session-title index.

Current normalization:

- Name: custom title → AI title → summary/index title → first prompt → ID.
- Time: transcript timestamps, falling back to file mtime.
- Workspace: `cwd` and `gitBranch`.
- Usage: assistant-message usage. Input includes ordinary, cache-read, and cache-creation tokens; output accumulates separately.
- Impact: prefer structured diffs in `toolUseResult.structuredPatch`; use heuristics over Edit/MultiEdit/Write arguments for older records without structured patches.
- Hierarchy: when `isSidechain=true` and `sessionId` points to another session, write `parent_session_id`. The sidebar can therefore collapse subagents under the main session.

AI blame: **`touched_files` is usable directly.** New-format line statistics approximate actual applied diffs; the old fallback counts only text lines in tool arguments.

### Codex

Main source: `~/.codex/sessions/**/*.jsonl`; titles come from `session_index.jsonl` or session metadata.

Current normalization:

- Name: session index/thread name → session metadata title → first prompt → ID.
- Time, model, repo path: rollout timestamp and turn context (`cwd`, `model`).
- Usage: latest `total_token_usage.input_tokens/output_tokens`.
- Impact: prefer `patch_apply_end.changes[path].unified_diff` for successful patches, covering `apply_patch` and patches wrapped by exec. Older rollouts fall back to parsing apply-patch tool calls.
- Hierarchy: resolve the parent from subagent `session_meta.parent_thread_id`, `source.subagent.thread_spawn.parent_thread_id`, and similar fields.

AI blame: **`touched_files` is usable directly.** It is among the strongest authoritative applied-patch signals of these loaders. Branch metadata is currently absent.

### Cursor

Main sources: `conversation-search.db` for discovery/change detection and `composerData:<id>` in `state.vscdb` for metadata. Bubbles load lazily when a session opens. See [Cursor IDE session metadata](./cursor-ide-metadata.md) for storage details.

Current normalization:

- Name/time/status/model/mode: composer metadata. Index `updated_at` is the authoritative recency for sorting.
- Workspace: `trackedGitRepos[0]`, falling back to `workspaceIdentifier`.
- Usage: the single `contextTokensUsed` total is stored in `input_tokens`; no reliable input/output split exists.
- Impact: `totalLinesAdded`, `totalLinesRemoved`, and `filesChangedCount`. `touched_files` comes from files in `originalFileStates` with an edit marker or newly-created status.
- Hierarchy: main composer's `subagentComposerIds` discovers children; a child's `subagentInfo.parentComposerId` determines its final parent. Children stay out of the root list and are collapsed through the sidebar's common child-session flow.
- Extra: `source_metadata_json` stores `status`, `isAgentic`, and `unifiedMode`.

AI blame: **`touched_files` is usable directly.** Cursor's line/file totals are its own session summaries; do not assume `touched_files.len()` always equals `filesChangedCount`.

### OpenCode

Main source: OpenCode `opencode.db`, reading the `session`, message, and part tables.

Current normalization:

- Name/time/model/repo: `session.title`, `time_created/time_updated`, model JSON, and `directory`.
- Usage: add cache read/write to input and reasoning tokens to output.
- Hierarchy: read `parent_id`, but map only valid container-parent/mirror relationships into `parent_session_id`, handling cycles, missing parents, and ORGII-managed mirrors.
- Impact: extract paths from this session's write/edit/patch/apply-patch tool parts. Prefer unified-diff counts when patch text exists; otherwise estimate lines from old/new/content arguments. Exclude failed edits.

AI blame: **`touched_files` is usable directly.** A child run computes impact from its own part stream, so its edits are not counted again under the parent.

### Windsurf

Main source: composer/bubble data in Windsurf `User/globalStorage/state.vscdb`.

Current normalization:

- Name/time/status/model, repo, branch, and a single `contextTokensUsed` value.
- Hierarchy: write `subagentInfo.parentComposerId` to `parent_session_id`. The child stays out of the root list and is collapsed through the common sidebar child-session flow.
- Impact: extract paths from each composer's own edit/write/apply-patch `toolFormerData`. Estimate lines when before/after content exists and ignore failed results.

AI blame: **`touched_files` is usable directly.** Impact is computed per composer, leaving subagent edits on the child row.

### WorkBuddy / CodeBuddy

Main sources: `~/.workbuddy/{projects,sessions,history.jsonl}`, `~/.codebuddy/...`, and CodeBuddyExtension JSONL.

Current normalization:

- Name: AI title/display → first user prompt → file stem.
- Time/model/repo/branch: JSONL timestamp, message model, `cwd`/`project`, `gitBranch`.
- Usage: support input/output, prompt/completion, and cache-token fields.
- Impact: recognize Edit, MultiEdit, Write, edit_file, write_file, apply_patch, and similar tools; collect a file only if arguments have a structured path field. Estimate line totals from old/new/content/edits text.
- Hierarchy: the observed `<parent-id>/subagents/agent-*.jsonl` layout provides a parent ID, while child JSONL has its own `sessionId`. Discovery imports these `agent-*` files, prefers the embedded child `sessionId` as source ID, and normalizes the directory parent ID into `parent_session_id`.

AI blame: **`touched_files` is usable directly.** The file set is generally reliable; line totals are heuristics over requested tool arguments, not successful applied diffs. Child transcripts are computed separately from parents.

### Trae

Main sources: `~/.trae-cn/memory/projects/**/session_memory_*.jsonl` and `~/.trae/memory/projects/**`. Plaintext files contain only turn summaries. Full transcripts are in the SQLCipher-encrypted `ModularData/ai-agent/database.db`, which this loader does not decrypt.

Current normalization:

- Name: session topic in `topics.md` → first summary intent → ID.
- Time: `message_summary_time`, with a fallback from the Mongo ObjectId-style session ID if creation time is missing.
- Repo: best-effort reconstruction of a filesystem path from the project directory slug.
- “Model”: read the agent ID from the VS Code `state.vscdb` index and convert it to a label such as `Solo Agent`; it is not the underlying LLM model.
- Extra: `source_metadata_json` stores the agent, whether current, and Trae list order.
- Tokens, branch, impact, and parent remain empty.

AI blame: **no reliable structured signal.** Natural-language summary `actions` sometimes mention files but cannot provide a stable blame index. A reliable file list requires decrypting the full DB, locating another plaintext event source, or inferring via repo/time correlation.

### Cline

Main source: `~/.cline/data/db/sessions.db` as the discovery/hierarchy index, reading each row's root or child transcript from `messages_path`. Older installations without the DB fall back to `~/.cline/data/sessions/<id>/<id>.messages.json`. Root sessions also read the `<id>.json` sidecar in the same directory.

Current normalization:

- Name: sidecar title → DB `metadata_json.title` → sidecar/DB prompt → first user text → ID.
- Time/model/repo/usage: prefer sidecar/transcript, filling gaps from DB started/updated, model, provider, workspace/cwd, and aggregate usage.
- Hierarchy: DB `is_subagent=1` plus `parent_session_id` directly defines the child relation.
- Impact: each DB row points to its own transcript; `editor` old/new/path arguments produce `touched_files` and heuristic line counts.
- Branch remains empty.

AI blame: **`touched_files` is usable directly.** A real Cline spawn confirmed that a root and its `<root>__agent_<agent>` child are distinct session rows. The child has a separate `messages_path` and explicitly points to the root, so subagent blame need not be inferred from tool names.

## AI blame readiness and next work

For a minimal blame feature that lists AI sessions which modified a given file:

1. **Ready:** Claude Code, Codex, Cursor, OpenCode, Windsurf, WorkBuddy, and Cline.
2. **Blocked on reliable source data:** Trae.

“Ready” means a loader writes queryable `touched_files`; it does not mean 100% historical coverage or path-format support across every version and edit tool.

Subagent/session hierarchy is a separate capability:

1. **Parent relation written:** Claude Code, Codex, Cursor, OpenCode, Windsurf, WorkBuddy, Cline.
2. **No reliable signal yet:** Trae.

The index should query normalized `touched_files` exclusively rather than making the blame feature understand every transcript format. Every new collector needs to:

1. Record only actual edit/write/patch operations, not read/search paths.
2. Normalize paths relative to `repo_path`, handling URIs, absolute paths, and platform separators.
3. Deduplicate files within a session.
4. Distinguish authoritative applied diffs from tool-argument heuristics.
5. Bump that loader's metadata parser version so old cache rows rebuild automatically.
6. Add fixture/unit tests for modified, created, deleted, renamed, and failed edits.

## Maintenance rule

When changing any external loader's `session_meta_to_cache_input`, Cursor's `cache_input_from_raw`, or fields of `ImportedHistoryCacheInput`, update in the same PR:

1. This capability matrix.
2. The relevant loader detail.
3. AI blame readiness categories.
4. Parser version and metadata/cache tests if existing cache rows change.
