# Remote onboarding and route ownership audit

| Line                             | Element           | Verdict          | Reason                                                                                        | Suggested change |
| -------------------------------- | ----------------- | ---------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| WelcomeScreen.tsx:30             | Pairing action    | keep with reason | One real pairing entry using the existing MobileActionButton; demo entry removed as requested | None             |
| MobileRemoteApp.tsx:30           | Route rendering   | keep with reason | Delegates intent ownership without introducing a parallel visual shell                        | None             |
| useMobileRemoteCoordinator.ts:97 | Stop confirmation | keep with reason | Single pending operation; navigation/unmount invalidate modal-local completion                | None             |

Totals: fix 0; keep with reason 3; abstract 0 (visual patterns only).

**Control-flow correction:** Stop rejection is owned by the coordinator reducer. Failure keeps the dialog open, clears the in-flight lock, displays a localized PageNotice, and permits retry. A rendered regression clicks the real modal button, rejects the desktop call, checks the error, and retries successfully. Navigation and unmount still invalidate old modal completions.

## Architecture

Reviewed ownership, route FSM, typed pairing intent, async stop lifecycle, errors and test coverage. Authentication, socket lifetime and persistent schema remain in their existing owners and are not changed here. The main app explicitly disables demo default; internal demo fixtures remain for test/development use. The old development-root test expected the removed Try demo action; its assertion is updated to require real pairing and reject that action.

Pairing progresses welcome → payload validation → SAS (when required) → connecting → sessions. Consumed links are guarded against repeated route resets. Stop is single-flight; changing route or unmounting invalidates only UI completion, not the already-issued remote command. Parent #1380 now contains the auth-owner and roster corrections. Physical navigation/focus/light-dark screenshots and actual stop/offline interactions are not reverified.

| Area               | Verdict | Evidence                                     | Change or reason kept                              | Verification                 |
| ------------------ | ------- | -------------------------------------------- | -------------------------------------------------- | ---------------------------- |
| Background work    | keep    | No added timer/poll/subscription             | User-triggered stop only                           | Coordinator tests            |
| Memory             | keep    | One consumed intent and one operation symbol | Bounded by hook lifetime                           | Static trace                 |
| Scope/isolation    | keep    | Route changes invalidate operation symbol    | Late stop cannot close a different session's modal | Regression test              |
| Rendering/hot path | keep    | No new streaming subscriber                  | Existing context use retained                      | No runtime performance claim |

Verification: full MobileRemote suite passed 267 tests in 46 files; the final reducer correction passed all 5 coordinator tests, typecheck, scoped ESLint and git diff --check. The existing audit keeps 3 visual patterns; PageNotice supplies the error state. Performance verdict: blocked — physical-device lifecycle measurements and screenshots were not run. No visual approval is inferred from jsdom.
