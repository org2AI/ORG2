# Tray session menu

The original tray menu contained hardcoded To dos and Recent sessions placeholders. The replacement projects the existing local sidebar roster, visited-state storage, and shared status predicates into a native menu. No source data was malformed, and no historical cleanup or persistence migration is needed.

Show Kanban and Show Runtime open their existing workbench tabs. Pinned, Unread, and Recent use native submenus; Running remains expanded in the main menu. Counts cover all matching loaded sessions, while each group displays at most five newest entries. Groups are disjoint: Pinned takes precedence, then Running, Unread, and Recent. Archived entries and empty groups are omitted. Counts describe the loaded roster, not an exhaustive history scan.

Unread includes Mark all as read. It uses the existing batch visited-state writer for all loaded, non-archived unread sessions, including pinned entries and those beyond the displayed five. It preserves existing read state, updates tray/sidebar counts, and does not navigate or focus an existing main window.

Native actions are retained in one pending slot until the main-window listener consumes them, including after webview recreation. The bootstrap hook emits the existing navigation event rather than depending on React Router context. Both IPC commands enforce main-window ownership.

| Area               | Verdict | Evidence                                                                                   | Change or reason kept                                                                             | Verification                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Background work    | keep    | One hook owns two store subscriptions and one native listener                              | Push updates only, including while hidden because the tray remains available; no polling or scans | Startup, late-listener cleanup, disposal and secondary-window tests        |
| Memory             | keep    | Four groups of five rows, one pending action, one in-flight and one latest queued snapshot | Native menu replacement; pending selection consumed once; queue cleared on stop                   | Projection bounds, coalescing, disposal and pending-action tests           |
| Scope/isolation    | keep    | Per-instance local roster; main-window guards                                              | No extra account/network cache; batch write uses existing visited-state storage                   | Browser/secondary-window tests; persistence test retains existing read IDs |
| Rendering/hot path | keep    | Store subscriptions avoid React rerenders; identical serialized snapshots are skipped      | No transcript hydration on submenu expansion; one batch mark-read update                          | Sync deduplication/order/error tests and single-update persistence test    |

## Lifecycle and compatibility

Startup sends the current roster and drains a pending native action after listener registration. Rename, pin, read-state and status changes update the snapshot; deletion removes rows. Unmount disposes subscriptions/listeners and drops queued writes. An existing hidden main window remains hidden for mark-all-read; navigation actions restore it. Recreated webviews may navigate by exact session ID before roster hydration completes.

The change adds private frontend/backend IPC commands and menu metadata. Ship the frontend and Rust backend together. It does not change persisted formats, dependencies, or database schema. Rollback is a code revert and rebuild; sessions and visited-state storage remain usable.

Native menu interaction, theme rendering, window recreation, hidden-window focus behavior, and CPU/RSS were not exercised through desktop control, which the user has not authorized. Automated tests establish projection, wire decoding, navigation dispatch, bounds and cleanup; they do not establish visual parity or measured runtime performance.

Performance verdict: blocked — native interaction and runtime resource measurements remain unverified. Exact automated commands and results are recorded in the pull request Verification section.
