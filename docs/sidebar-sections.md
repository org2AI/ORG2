# Personal session sidebar sections

Custom sections appear below Pinned in the local/personal Sessions sidebar. Use a session's **Section → New section** submenu to create and assign in one transaction. No additional sidebar button is added. A session belongs to at most one custom section. Section headers support rename, move up/down, collapse, and deletion. Drag a session onto a section header (including an empty section) or another section's row to move it. Dragging into ordinary rows removes its section membership.

Project, workspace, activity timestamps, and provider metadata do not change. Pinning takes visual precedence and preserves membership; unpinning returns the session to its section. The bottom unpin drop area also preserves membership. Deleting a section removes only its organization records, never sessions. Empty sections remain visible. Within-section row sorting follows the existing sidebar sort preference. Project rows and cloud team sessions are outside this feature's scope.

## Ownership and boundaries

Rust owns `sidebar_sections` and `sidebar_section_members` in the existing local application SQLite database. Additive `CREATE TABLE IF NOT EXISTS` initialization is shared by all three RPC entry points; no existing data reset or migration is required. Names are trimmed and validated; section IDs are UUIDs. Limits are 100 sections and 10,000 assignments, enforced at the transactional write boundary. Reordering must supply each current section exactly once. Assignment validates the session against the directory's native/imported authoritative lookup; unlistable imported records, children and archived native sessions cannot be assigned.

`sidebar_sections_list`, `sidebar_sections_mutate`, and `sidebar_section_page` have matching Rust serde and TypeScript Zod contracts. Mutations publish a `sidebar-sections-changed` invalidation event. TypeScript displays confirmed mutations; failed writes leave the previous membership visible. This avoids a second optimistic membership authority. Collapse preference stays in localStorage, bounded to 100 custom IDs.

Section membership pages use the indexed `(section_id, session_id)` key and exact-ID hydration, rather than scanning provider histories or relying on the ordinary sidebar's currently loaded pages. The cursor advances even if a source row is absent. Existing live session entities take precedence over delayed hydration results. Ordinary organization/source eligibility filters still apply; only roster pagination is bypassed for section-loaded identities. Recently loaded identities are retained within a 10,000-ID bound so removing membership does not immediately lose an older row from the open sidebar.

Membership uses the directory's exact session ID. It survives app/database reopening and temporary source unavailability; automatic reassignment across a provider changing its session identity is not introduced. Cross-device synchronization is not introduced. Rolling back the code leaves the two additive tables harmlessly unused; no session content recovery is required.

## Architecture review

| Layer                   | Coverage                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation           | Rust library compiled and targeted storage tests passed; TypeScript native check reports unrelated useAppNavigate errors in the isolated PR checkout |
| 2 Duplication           | Shared store and directory converters; no per-provider section implementation                                                                        |
| 3 Naming                | SidebarSection denotes personal presentation organization                                                                                            |
| 4 Semantic overload     | Separate from projects, Agent Orgs, and provider categories                                                                                          |
| 5 Defaults              | No section means normal grouping; pin wins without clearing membership; empty headers remain                                                         |
| 6 Domain boundaries     | Organization writes cannot modify runtime/project/provider/pin records                                                                               |
| 7 Discoverability       | Section store, controller, projection and RPCs have explicit owners                                                                                  |
| 8 Wire protocol         | Serde mutation/null and snapshot-key regression tests; matching Zod schemas; bounded page input                                                      |
| 9 Initialization parity | List, mutate and page all invoke the same additive schema initialization                                                                             |
| 10 Resolver symmetry    | One lookup supplies native/imported section hydration and assignment validation; same native converters and Agent Org decoration as the directory    |

No LLM wire, provider ingestion, runtime FSM, cloud transport, or schema migration behavior changes. Those runtime audits are outside this feature's scope.

## Verification

- `cargo check --manifest-path src-tauri/Cargo.toml --lib`: passed
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::session_directory::sections`: 6 passed; linker emitted a large unwind-section warning
- `pnpm exec vitest run --config config/vitest.config.ts --minWorkers=1 --maxWorkers=2 src/scaffold/NavigationSidebar/connectors/sections src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/useSessionSidebarOrdering.test.ts src/scaffold/NavigationSidebar/connectors/useSessionMenuItems/__tests__ src/api/tauri/rpc/__tests__/sessionAggregateSchemas.test.ts`: 75 passed on the final run
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib`: passed without warnings
- ESLint on changed frontend production/test files: passed
- `pnpm run check:test-placement`: passed
- `pnpm exec tsgo --noEmit --pretty false`: blocked by unrelated `useAppNavigate.test.ts` assertion-matcher errors and `useAppNavigate.ts:24` catch-on-never error in the latest base; no section errors. The earlier shared-tree `tsc` run reported an unrelated SearchInput test error
- `pnpm run check:i18n-keys`: passed in the isolated PR checkout, including all 13 section locales
- `pnpm run check:circular`: reports three existing cycles in SessionCore and HoverCard, none involving section files
- `git diff --check`: passed

No native GUI, theme/viewport screenshots, or CPU/RSS measurements were run because computer control requires explicit user opt-in. See the UI and performance audit reports for the coverage limits. Unrelated working-tree changes were preserved.
