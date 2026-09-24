# Shared attachment side preview

## Design and ownership

Clicking a shared attachment immediately reveals a workstation preview tab without route navigation. The active viewer automatically fetches the immutable cloud snapshot into memory. Previewing does not require a save dialog or write a file into Downloads. The optional Download action keeps the existing explicit download behavior. Text up to 128 KiB, supported images and PDF use the existing safe preview paths; unsupported/large text remains downloadable. This change does not introduce an editor, disk cache, or new transport.

Both portable orgii-file links and conversation sender paths share the tab opener. Exact source uploader/revision and endpoint remain authoritative; unresolved inherited paths never become receiver-local reads or latest-version lookups. Tabs are keyed by identity and file/version, or by identity and event/path while waiting for event provenance. Mounted event provenance can resolve a waiting tab without reopening it or stealing focus. If an unresolved source event disappears, the preview reports an error rather than inventing provenance. Reopening the link in the updated conversation is still necessary in that case; automatic correlation across replaced historical event identities is not claimed.

The active renderer owns the request, bytes and Blob URL. Closing/deactivating it aborts the request and releases its state; Blob URLs are revoked. Returning to an inactive tab downloads again, trading repeat bandwidth for bounded retained bytes. Small runtime tab descriptors live until tab/workspace disposal. A capability closure keeps share tokens out of serializable data, and every persistence partition excludes the complete shared-file tab plus active/order references. Deserialization does not recognize this transient type. Account changes hide old bytes immediately and cannot use the new account to fetch an old account's tab.

## Architecture review

| Layer             | Coverage                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation     | TypeScript typecheck and changed-file lint passed; Rust is unchanged.                                                                                                                                                |
| 2 Structure       | Removed the modal owner and shell; both entry points use one opener.                                                                                                                                                 |
| 3 Naming          | `shared-file` is explicitly a cloud snapshot, never a local `file` tab.                                                                                                                                              |
| 4 Semantics       | Opening identity, authoritative reference, optional pending-origin atom and runtime access capability are separate fields. Pending reference null means waiting; undefined means its unresolved event was abandoned. |
| 5 Defaults        | Explicit category/ownership/renderer mapping; no persisted restore or receiver-path fallback.                                                                                                                        |
| 6 Boundaries      | Feature owns cloud/auth semantics; workstation registry is a thin adapter.                                                                                                                                           |
| 7 Discoverability | Comments document transient persistence and active-viewer ownership.                                                                                                                                                 |
| 8 Serialization   | Actual localStorage output tested across shared/global/session/directory/legacy partitions. No API, schema or wire-format changes.                                                                                   |
| 9 Entry parity    | Portable links and inherited/path links converge on one opener and viewer. Existing cloud read/version tests remain.                                                                                                 |
| 10 Resolution     | Source version is still exact; unresolved metadata cannot silently select a newer upload. No multi-field backend resolver changed.                                                                                   |

## Performance guard

| Area               | Verdict | Evidence                                                                  | Change or reason kept                                                                        | Verification                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | keep    | One active viewer request; no new polling/timers                          | Abort on deactivation/close; retry is explicit                                               | Unit abort tests; native held-read abort on tab close                                 |
| Memory             | keep    | One active byte buffer plus optional media Blob; inactive viewer unmounts | No attachment cache retained in tab data; revoke URL                                         | Renderer deactivation and image URL tests                                             |
| Scope/isolation    | fix     | A tab outlives its originating chat component                             | Bind opening identity; runtime capability only; transient persistence across every partition | Auth change, different endpoint, persistence and source-version tests                 |
| Rendering/hot path | fix     | Centered dialog interrupts chat                                           | Lazy workstation renderer, one tab for repeated clicks; no local tree beside cloud content   | Real native geometry and repeated click                                               |
| Origin hydration   | fix     | Original first click could show only a toast                              | Inline waiting driven by event-origin state; no polling                                      | Unit hydration without another click; native cold-open checks, with limitations below |

## Verification

- `pnpm test src/features/Org2Cloud/SharedSessionFileViewer.test.ts src/features/Org2Cloud/SharedSessionFilesContext.test.ts src/features/Org2Cloud/openSharedSessionFile.test.ts src/store/workstation/tabs/__tests__/storage.test.ts src/store/workstation/tabs/__tests__/workspaceState.test.ts src/modules/WorkStation/TabContent/renderers/sharedFile.test.ts`: 59 tests passed.
- `pnpm typecheck:fast`: passed.
- Changed production and unit-test files: `pnpm exec eslint <changed .ts/.tsx paths>` passed.
- `node --check tests/e2e/specs/core/cloud-dual-instance-ui.spec.mjs`: passed; full real-provider scenario not rerun.
- Isolated native WebKit: actual assistant attachment click, real original cloud bytes, unchanged route, visible chat, no modal. Final preview x=660 versus chat x=256; repeat click kept one preview.
- Native lifecycle: hold a real read, see loading, close and observe abort; inject offline error, see inline retry, restore transport and retry to real bytes. Five close/reopen cycles succeeded. Five seconds after final close produced zero additional file reads. Fault injections were not counted as successful cloud reads.
- Native light/dark screenshots inspected. Debug WebDriver screenshot failed to render most pixels; native window capture provided the evidence.
- Initial pre-fix cold open required another click. An intermediate origin-wait version abandoned its pending origin when scope changed. Event ownership was narrowed to event identity; subsequent cold-open runs rendered original bytes on the first scripted click. Replacement/removal of unresolved historical event identities can still yield an inline error; this is explicitly not complete provenance hydration acceptance.
- No new attachment uploads, account cycling or resource changes were requested for this UI test. It reused the authorized synthetic test-org attachment.

Performance verdict: **blocked** for comprehensive performance acceptance. This focused run proves interaction, cancellation and short post-close quiescence, not a CPU/RSS budget across hidden-window, long-session and packaged-platform lifecycles. The existing high WebKit peaks, original 164-item mismatch, Luna capacity and large cloud upload investigation remain outside this UI change.

## Compatibility and recovery

The new tab is intentionally ephemeral and cannot be restored after restart. Existing saved tabs are unchanged; no migration or destructive cleanup occurs. Reverting the commit restores the old interaction without changing cloud bytes. The UI branch depends on the provenance branch; the native integration also included the separately reviewed codec/deadline fix. Image URL cleanup is unit-tested; native image/PDF rendering on every desktop platform is not certified here.
