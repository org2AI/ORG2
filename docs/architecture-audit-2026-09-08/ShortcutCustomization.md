# Shortcut customization architecture audit

The owning preference boundary is `src/config/keyboard/shortcutBindings.ts`: a versioned localStorage snapshot (`orgii:shortcutOverrides:v1`) keyed by mac/windows/linux and canonical command ID. Defaults remain in the existing catalog. Recording writes validated overrides, with conflict checks at the writer as well as in the UI. Reset deletes overrides. No prior stored shortcut configuration existed, so no historical cleanup or migration was performed.

The original implementation exposed a read-only catalog, dispatched literal chords independently, and cached some label strings at module initialization. The change resolves customized bindings for global dispatch, chat navigation/send, save/reload, editor find/replace/go-to-line, SQL execution, Git actions, work-item context actions, and native context menus. Shared aliases preserve command identity. Native application-menu overrides survive menu rebuilds; embedded webviews receive the latest bounded snapshot both on edits and page loads.

## Ten-layer coverage

| Layer                  | Finding and disposition                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation          | TypeScript and native system_services/browser compilation checked; see verification below                                                                                                                       |
| 2 Deduplication        | Global literal switch replaced by ID matching; immutable defaults parsed into a catalog-sized cache; event callbacks retain their original context owners                                                       |
| 3 Naming               | `KeyBinding` means normalized physical chord, `ShortcutOverrides` means per-platform customizations, `ShortcutEntry` remains display/default metadata                                                           |
| 4 Semantic overloading | Display strings no longer serve as work-item event matchers; command aliases resolve through canonical IDs                                                                                                      |
| 5 Defaults             | Missing/invalid entries fall back to catalog defaults. macOS, Windows, and Linux override maps are independent. Existing send-on-Enter behavior applies when chat_send has no override                          |
| 6 Boundaries           | Keyboard preferences do not dispatch business actions. Existing owning handlers do. app_window holds one serialized embedded-view snapshot, avoiding a browser/system-services dependency cycle                 |
| 7 Discoverability      | Editable rows use buttons; fixed catalog rows retain badges. Input capture, persistence, native sync, and React subscription helpers have separate owners                                                       |
| 8 Serialization        | Persistence tests inspect the actual JSON. Native command accepts a bounded allowlisted menu map and bounded forwarded chords; serialized script payloads use serde_json escaping. No schema/database changes   |
| 9 Initialization       | Main UI hydrates storage on module load; storage subscriptions refresh cross-window edits. Native menus refresh on global shortcut mount. New/reloaded inline webviews read the same snapshot as existing views |
| 10 Resolver symmetry   | Display, dispatch, and accelerators use the same override→default chain. Static configuration uses getters; mounted shortcut UI subscribes by resolved label                                                    |

## Coverage and limitations

71 canonical commands plus six alias rows are editable. Fixed entries remain read-only because their existing editor/control/native dispatchers are outside this change: minimize/hide, browser DevTools/editor switching, hunk review, generic list/modal/spotlight navigation, text-entry gestures, save-all, definition/reference/history/formatting editor commands, work-item search, and database connections. No editable row is presented for these unsupported paths.

Shortcuts require Control, Command/Meta, or Alt, or a function key; bare Escape/Tab cancel recording. OS-reserved chords may remain unavailable to the webview. Native synchronization errors are reported; actual OS interception behavior has not been tested on the three platforms. Preferences are local to this application profile, not cloud-synced. Deleting/resetting this preference key restores defaults; no user domain data is touched.

## Verification

The isolated PR branch was created from the latest origin/develop, with unrelated tray, document-preview, and navigation changes excluded. The focused shortcut suite passed **88 tests in 14 files**:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/components/ComposerInput/__tests__/ComposerInput.lineBreak.test.ts \
  src/components/KeyboardShortcut/index.bindings.test.ts \
  src/config/keyboard/nativeShortcutSync.test.ts \
  src/config/keyboard/shortcutBindings.test.ts \
  src/engines/ChatPanel/ChatPanelTabShortcuts.test.ts \
  src/features/CodeMirror/SqlEditor/SqlEditor.test.ts \
  src/hooks/navigation/useGlobalShortcuts/__tests__/customizedShortcuts.test.ts \
  src/hooks/voice/useVoiceShortcut.test.ts \
  src/modules/MainApp/Settings/sections/ShortcutsSection/ShortcutRecorder.test.ts \
  src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/FileTreeContent/__tests__/customizedShortcuts.test.ts \
  src/components/KeyboardShortcut/index.test.ts \
  src/config/keyboard/shortcutDisplay.test.ts \
  src/hooks/navigation/useGlobalShortcuts/__tests__/digitZeroShortcut.test.ts \
  src/hooks/navigation/useGlobalShortcuts/__tests__/workstationEditorToolShortcut.test.ts
```

TypeScript (`pnpm exec tsc --noEmit --pretty false`) and scoped ESLint (`pnpm exec eslint <changed TS/TSX files> --max-warnings 0`) passed. Native compilation uses `cargo check -p system_services -p browser --manifest-path src-tauri/Cargo.toml`. Scoped diff whitespace checks passed.

File-tree Enter/F2 and primary-modifier Backspace/Delete defaults remain available until that command is remapped. Deletion still uses its existing confirmation and file.delete producer. Both composers share one push-to-talk listener lifecycle: an active press survives rerenders, releases on its original key/modifier, and stops on blur, disable, or unmount. Tests exercise the producing preference writer, actual file-action dispatch, live tooltips, recorder lifecycle, embedded JavaScript, and voice lifecycle.

No live native GUI, Windows/Linux runtime, screenshot, or CPU/RSS verification was performed; computer control was not authorized.
