# Sidebar sections performance review

| Area               | Verdict | Evidence                                                                                               | Change or reason kept                                                                                                                                  | Verification                                                                |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Background work    | keep    | One mounted sidebar owner, Tauri change listener, focus and visibility listeners; no timers            | Push/focus refresh; no new page reads while hidden; listener disposal and generation invalidation on leaving local sessions                            | Hook tests for collapse, visibility return and late results after disable   |
| Memory             | keep    | At most 100 sections, 10,000 memberships, 10,000 retained row IDs; page size 20 with server maximum 50 | Backend write limits; page maps reset on invalidation; retained IDs bounded to keep recently unassigned rows reachable                                 | Rust section limit and pagination tests; source inspection of retention cap |
| Scope/isolation    | keep    | Local machine database and local UI preferences; personal/local sidebar only                           | Cloud team sidebar is excluded; existing organization and external-source filters still apply to hydrated members                                      | Hook disable test; source trace of eligibility and generation checks        |
| Rendering/hot path | keep    | One pass buckets rows; no transcript parsing or provider scans in section requests                     | Exact-ID hydration of a bounded SQL membership page, imported pins read once per page; existing live entities are not overwritten by delayed hydration | Projection tests and older-member hydration tests                           |

## Lifecycle coverage

- Start: section snapshot, then bounded first pages for expanded sections; serialized page requests
- Idle: no recurring work
- Hidden: no new section page requests; visibility return refreshes the snapshot
- Collapse: first page deferred until expansion; loaded rows remain bounded
- Unmount/disable: native and DOM listeners disposed; late reads cannot hydrate sessions
- Delete section: membership removed transactionally, sessions and project/pin fields retained; loaded rows remain reachable in normal grouping
- Deleted/archived source: backend exact-ID lookup omits absent/archived/unlistable rows; pagination advances by membership ID even when rows have disappeared
- Network/auth/cloud scope: metadata is local, with no network or cloud synchronization added
- Imported source transitions and multiple desktop instances: not exercised; no ingestion/parser behavior is changed, and no cross-device or provider-rotation guarantee is claimed

Performance verdict: blocked — automated lifecycle checks pass, but native visible/hidden idle CPU/RSS and repeated real-app open/close measurements were not run because desktop computer control was not authorized. No measured performance improvement is claimed.
