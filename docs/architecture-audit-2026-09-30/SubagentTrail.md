# SubagentTrail architecture audit

Objective: inspect child tasks beside the current chat without changing Station tabs or moving the chat/draft owner. This change excludes the P1 acceptance mockup, source-browser work, and general Station floating-mode migration.

| Layer                   | Result and evidence                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilation             | Full frontend typecheck and targeted suites pass; native checks are recorded in the PR verification.                                                                                         |
| Dead code / duplication | Deletes the dedicated Subagent submenu. Roster projection/resource and parent-event projection are shared with Simulator. Removes obsolete translation keys.                                 |
| Naming                  | SessionTrailSurface owns temporary presentation; SubagentTrail owns task content; eventStore owns loaded history.                                                                            |
| Semantic overload       | Child raw status is preserved independently from simulator's mapped status. Stop does not label a task complete optimistically.                                                              |
| Defaults                | No new persistence default or migration. Main ChatHistory spacing is unchanged unless explicit transcript padding is passed.                                                                 |
| Domain ownership        | Native child records remain authoritative for identity/status; cached parent tool events contribute task labels only.                                                                        |
| Discoverability         | Feature files live in features/SubagentTrail; scoped history hydration and stop action are reusable owner-boundary modules.                                                                  |
| Wire compatibility      | No IPC/schema changes. Optional frontend fields carry existing native data. The native reader accepts explicit provider subagent metadata and leaves ordinary rollouts on the existing path. |
| Entry parity            | Compact/wide rail summary and individual child entries open the same scoped surface. Imported history uses the same adapter as main chat, not a cache-only path.                             |
| Resolver symmetry       | Surface reads/writes both check parent session and chat-tab identity. Single-flight history loads use version compare-and-set and protect existing main-chat history.                        |

## Source-level empty-history diagnosis

Authoritative input is the provider Codex JSONL. A child task can contain task_started plus real assistant/tool events without a UserMessage. The ordinary conversational initial-window collector could omit that activity. The reader now selects a bounded task window using explicit subagent_history_start_ordinal and native turn_id before existing parsing/ingestion. A synthetic fixture exercises child-owned events and copied parent exclusion; an ingestion regression checks visible derived activity. This is a read-path invariant: no new writer, synthetic user message, filename filter, stored-record deletion or migration is introduced. Historical files are read in place and require no destructive remediation.

The frontend also previously loaded only EventStore cache for scoped readers. ensureSessionHistoryInStore hydrates empty imported stores through the authoritative adapter. It does not replace nonempty stores or overwrite newer concurrent chat loads. Historical source/title metadata fixes in separate PRs are not included here.

## Interaction lifecycle

Closed → opening/loading → populated/empty/error; error supports retry while retaining prior roster. List → selected history → back preserves list scroll. Fullscreen changes shell bounds without replacing content. Close or parent switch releases subscriptions and hides the scoped surface. Stop validates parent ownership, deduplicates concurrent requests and exposes a retryable error without claiming success.

Regression coverage includes list/detail navigation, direct child entry, parent scope changes, stale async results, imported history retry/concurrent loads, stop failure/retry, motion cancellation and bounded source scanning. No architecture-wide cleanup or public API redesign is included.
