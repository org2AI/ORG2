# Queue authority lint

`pnpm check:queue-authority` enforces the AGENTS.md invariant that queue finality comes from the turn-lifecycle FSM. It checks the two current owners: useQueueDispatch and queueDispatchSyncInputsAtom.

The rule forbids imports of sessionRuntimeStatusAtom, isSessionActiveAtom, isSessionEngineActiveAtom and isPendingCancelAtom into these owners, including renamed named imports. Namespace property access, string-literal computed access and destructuring from the session-state module are also checked. FSM access and setSessionRuntimeStatusAtom remain allowed: publishing a status mirror is different from using it to decide whether to dispatch.

This is intentionally a narrow import/access rule, not whole-program dataflow analysis. It cannot identify arbitrary helper functions that hide a mirror read, re-export that renames the forbidden symbol, dynamic computed property names, or a new dispatcher owner. Update the owner list if these files move, and review newly introduced helpers. Display components can continue reading status mirrors. The dedicated runner disables inline configuration and fails on missing owners, parse errors and lint errors; no baseline exceptions were needed.

`pnpm test:queue-authority` covers renamed imports, namespace/dynamic-literal/destructuring access, Windows paths, derived inputs, permitted writes/FSM reads and ordinary UI consumers. Four tests and the real two-file scan pass. No production code or dependency changes; revert the dedicated CI workflow, scripts and package scripts to roll back.

Architecture coverage: FSM source of truth and prevention of parallel control-flow inputs. Native runtime performance, wire protocol and persistence are unchanged. No claim of whole-application queue correctness follows from this static rule.
