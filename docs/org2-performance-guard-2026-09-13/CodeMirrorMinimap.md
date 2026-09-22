# CodeMirror minimap

The canvas previously stopped at the host's bottom edge, but the slider moved across the host independently. This left later code invisible and clicks addressed only the document's first rows. Grabbing the slider also immediately centered the editor on the clicked line.

The extension now retains a drawing of the visible minimap area plus 128px of buffer on each side, translates it with the visible code, projects CodeMirror blocks into logical line coordinates, and preserves the initial slider grab position. Wheel events scroll the owning editor. Character marks preserve spaces and tab stops. The transparent host and neutral draggable slider follow the navigation described in [VS Code's minimap documentation](https://github.com/microsoft/vscode-docs/blob/main/docs/editing/getting-started/userinterface.md).

The viewport rules also contained CSS-module `:global(...)` selectors in a plain SCSS file. Both build configurations use global CSS for this file, leaving those selectors invalid in the browser; the slider therefore received neither positioning nor fill. The minimap selectors now use ordinary classes, and a compiled-SCSS regression test matches them against the plugin DOM, covering idle fill, positioning, and drag fill. No persisted data or historical cleanup is involved.

The viewport highlight stays visible while editing, with a left edge and stronger hover/drag fills. It uses the text token directly because the gutter token is already translucent, which made the previous mixed fill too faint.

The existing 1,500-line disable threshold remains. This is not a large-file minimap implementation. No persistence format, wire contracts, or React action buttons changed. The editor host now exposes a native context menu through the shared `popupNativeMenu` lifecycle owner. The canvas and slider are native DOM owned by a CodeMirror ViewPlugin; they are a scroll surface, not substitute action buttons.

| Area               | Verdict | Evidence                                                                                          | Change or reason kept                                                                                                      | Verification                                                                                                                                             |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background work    | fix     | Previously separate redraw/scroll frames and permanent document drag listeners                    | One pending redraw frame; drag listeners exist only during drag; blur, visibility and destroy release them                 | Hidden/resume, blur and destroy regression tests                                                                                                         |
| Memory             | fix     | Canvas height is at most panel height rounded to a row plus 256px, independent of document length | Reuse unchanged backing dimensions; set dimensions to zero on hidden document, collapsed host, and destroy                 | Pixel-bound, edit allocation, collapse/resume, hidden/resume, destroy tests; native RSS not measured                                                     |
| Scope/isolation    | keep    | All drawing, handlers and observer state belong to the ViewPlugin instance                        | No shared caches or cross-editor events                                                                                    | Two mounted editors; destroy one without affecting the other                                                                                             |
| Rendering/hot path | fix     | Small scrolls only transform drawing and slider; crossing the buffer repaints only buffered rows  | Coalesce edits; traverse token spans once per row; bound columns and rows; refresh on resize/reconfiguration/parser change | 20 small scroll events cause zero paints; 20 end-jump events cause one paint; 10 edits cause one deferred paint; offscreen edit/backward scroll coverage |

Lifecycle coverage: initial mount, active scroll/drag/edit, visible idle, document hidden and resumed, collapsed host and resumed, resize, window blur, and destroy. Network, authentication, provider ingestion, and transport are inapplicable. Multi-editor isolation is tested; primary/secondary native processes are not measured.

Verification:

- `pnpm test src/features/CodeMirror/config/minimap.test.ts src/features/CodeMirror/config/minimap.styles.test.ts` — 11 tests pass
- `pnpm exec eslint src/features/CodeMirror/config/minimap.ts src/features/CodeMirror/config/minimap.test.ts` — pass
- `pnpm typecheck:fast` — pass on final run (an unrelated SearchInput test type error appeared on the earlier run)
- `git diff --check -- src/features/CodeMirror/config/minimap.ts src/features/CodeMirror/config/minimap.test.ts src/features/CodeMirror/Editor/index.scss` — pass
- Production diff inspected: no new action controls, dependencies, secrets, or unrelated edits
- Native visual verification, theme screenshots, CPU/RSS, and real Tauri open/close measurements not run: user instructions prohibit desktop control without explicit opt-in. jsdom geometry fixtures verify behavior, not native layout or performance. Fold projection uses CodeMirror block ranges but native folded-document rendering remains unverified.

Resource evidence from deterministic jsdom fixtures (canvas context mocked):

- At 1,499 lines, an 80×208 CSS-pixel host, and DPR 2, the previous full-document dimensions implied 3,847,680 RGBA bytes. The bounded canvas dimensions now imply 593,920 bytes (84.6% smaller). These are nominal pixel-storage estimates, not measured process RSS or GPU allocation.
- At 1,000 lines with two visible characters per row, initial `fillRect` calls fell from 2,000 to 460 (77% fewer calls). Tests assert the current count. This is work-count evidence, not a frame-time benchmark.
- Edits do not reassign unchanged canvas dimensions, avoiding unnecessary buffer resets. Hidden/collapsed/destroyed instances have zero backing dimensions.
- Tradeoff: crossing the 128px buffer requires a bounded repaint; the previous full-document canvas could translate at all scroll positions without repaint. Native fast-scroll smoothness and high-DPI visual quality remain unverified.

Native context menu and settings follow-up:

- Right-click on the minimap opens a native “Hide Minimap” action, translated in all 13 locales. No raw React buttons or substitute click actions were introduced; this is a context-menu event on the existing scroll surface.
- The action sets `editorShowMinimapAtom` to false. Its existing writer updates `editor.showMinimap` and queues the standard settings partial write. No new persistence path was introduced.
- Global off takes precedence over `enableMinimap={true}`. Explicit false still opts out while settings are on. The same effective value gates the host and the production `useEditorExtensions` factory branch.
- Integration tests exercise the real extension builder and CodeMirror ViewPlugin lifecycle with a mocked native menu and settings atom. They verify no factory invocation on an off mount, removal on a settings/menu change, off remount, reenable, and caller opt-out. Native OS menu appearance and disk persistence were not manually exercised.
- Shared menu lifecycle ownership avoids extra retained resources or duplicate menu popups; its existing tests are included in the targeted run.
- `pnpm test src/features/CodeMirror/Editor/Editor.minimap.test.ts src/features/CodeMirror/config/minimap.test.ts src/features/CodeMirror/config/minimap.styles.test.ts src/util/platform/tauri/nativeMenuPopup.test.ts` — 27 tests pass across 4 files
- `pnpm exec eslint src/features/CodeMirror/Editor/index.tsx src/features/CodeMirror/Editor/types.ts src/features/CodeMirror/Editor/Editor.minimap.test.ts` — pass after naming the test adapter component
- `pnpm typecheck:fast` — pass
- `pnpm check:i18n-keys` — blocked by unrelated unused `common:tooltips.openDiff`; no missing keys, locale gaps/extras, or placeholder mismatches

Performance verdict: blocked — native visual/CPU/RSS lifecycle measurements were not performed. Automated lifecycle, pixel bounds, and redraw invariants pass; no runtime speedup or total-app RAM reduction is claimed.
