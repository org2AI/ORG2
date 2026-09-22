# DropdownSearch autofocus UI audit

| Line                                             | Element                         | Verdict          | Reason                                                                                                                                                                                         | Suggested change                                                     |
| ------------------------------------------------ | ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/components/Dropdown/DropdownSearch.tsx:103` | Shared search focus default     | fix              | Searchable custom menus, including SourceControlScopeToolbar, previously required an extra click because autofocus defaulted to false. The requested standard belongs in the shared primitive. | Applied: default autofocus to true; preserve explicit false opt-out. |
| `src/components/Dropdown/DropdownSearch.tsx:134` | Focus lifecycle                 | keep with reason | One existing 10 ms timeout per mount, cancelled on unmount or opt-out; query updates do not rerun the effect. Standard Dropdown's duplicate timer was removed.                                 | Keep ownership in DropdownSearch.                                    |
| `src/components/Dropdown/DropdownSearch.tsx:194` | Native input and shared styling | keep with reason | This is the design-system input primitive; its native input, localized accessible name, and existing tokens remain appropriate. No visual layout changes.                                      | None.                                                                |

Verdict totals: **1 fix**, **2 keep with reason**, **0 abstract**.

## Performance guard

| Area               | Verdict | Evidence                                                                                          | Change or reason kept                                          | Verification                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Background work    | fix     | DropdownMenuSurface returns null when closed; DropdownSearch owns a cancellable one-shot timeout. | Removed duplicate parent focus timer; no recurring work.       | Default focus, close-before-focus cancellation, repeated click open/close tests. |
| Memory             | keep    | One input ref and at most one pending timeout per mounted search.                                 | No caches or growing retained state.                           | Pending timer cleanup test.                                                      |
| Scope/isolation    | keep    | Ref and timer are component-local.                                                                | No identity, network, persistence, or shared resource changes. | Explicit opt-out test.                                                           |
| Rendering/hot path | keep    | Effect depends only on autofocus.                                                                 | Search value changes do not refocus.                           | Update-with-external-focus test.                                                 |

Native Tauri verification and CPU/RSS measurements were not run: desktop control is not authorized. Automated DOM tests cover the focus behavior; no measured runtime performance improvement is claimed.

## Verification

- `pnpm test src/components/Dropdown src/components/Select/index.test.ts`: 65 tests passed across 11 files.
- `pnpm run typecheck:fast`: passed.
- `pnpm exec eslint src/components/Dropdown/DropdownSearch.tsx src/components/Dropdown/DropdownSearch.test.ts src/components/Dropdown/DropdownOptionsContent.tsx src/components/Dropdown/index.tsx src/components/Dropdown/index.test.ts`: passed.
- `git diff --check`: passed.

Performance verdict: blocked for native runtime measurement under the user's desktop-control restriction; automated focus lifecycle checks pass.
