# Sidebar subagent expansion

The reported pinned session has a real completed subagent and persisted events.
No stored parent/child records need repair. `useSessionMenuItems` correctly
inserted the expanded child, but `buildCloudScopedMenuItems` repartitioned each
flat row by its own pinned flag and paginated children as independent sessions.
This separated an unpinned child from its pinned parent or cut it off at a page
boundary. The disclosure action itself was valid.

The producing menu projection now carries `parentItemId` on expanded child rows.
Cloud grouping and pagination operate on roots, then attach each root's children
in original order. Collapsed parents produce no child rows; parents without
children retain no subagent disclosure action. Local grouping with no cloud rows
is unchanged. The new field is transient menu metadata, not persisted domain data
or a wire/schema migration. Historical remediation: none; no records deleted.

| Area               | Verdict | Evidence                                                                       | Change or reason kept                                                             | Verification                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | keep    | Only synchronous menu projection changes                                       | Existing child-query scheduler, visibility lifecycle, and subscriptions unchanged | Child-query lifecycle and view-state tests pass                                       |
| Memory             | keep    | Temporary child map bounded by current projected rows                          | No retained cache or timer added                                                  | Map allocated per grouping call and discarded with its result                         |
| Scope/isolation    | fix     | Child rows carry the producing parent's menu identity                          | Pin partition and page selection cannot separate a family                         | Pinned-parent and page-boundary regressions failed before fix and pass after          |
| Rendering/hot path | keep    | One input pass plus output assembly; child rows excluded from root page counts | No additional IPC, provider scan, or subscription                                 | Real row-action click / collapse integration with production roster projection passes |

Verification (also rerun on the isolated branch based on latest develop):

- `pnpm test src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/DesktopSessionRosterProvider.test.ts src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/cloudScopedMenuItems.test.ts`: 25 tests passed. The integration test hydrates a child through the existing query hook, clicks the shared disclosure control, checks final row order after cloud grouping, then collapses. A childless sibling has no disclosure.
- `pnpm test src/scaffold/NavigationSidebar/connectors/useSessionMenuItems/__tests__/paginationHelpers.test.ts src/scaffold/NavigationSidebar/connectors/useSessionMenuItems/__tests__/useSidebarChildSessions.test.ts src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/useSidebarRosterViewState.test.ts`: 19 tests passed.
- `pnpm exec tsgo --noEmit --pretty false`: passed with no diagnostics.
- ESLint on all five changed TypeScript/TSX files: passed.
- `git diff --check -- src/scaffold/NavigationSidebar`: passed.
- Production diff adds no action controls, native buttons, or substitute clickable elements.

Architecture review: checked menu metadata ownership, parent identity propagation,
root/child semantics, and local/cloud grouping parity. No network serialization,
backend resolver, persistence write, or session initialization changes. This is a
behavioral projection fix, not a component styling/refactor audit.

Performance verdict: blocked on real desktop CPU/RSS measurement. No runtime
performance improvement is claimed. Desktop visual confirmation remains pending; automated rendered interaction evidence is jsdom. No isolated desktop screenshot is claimed.
