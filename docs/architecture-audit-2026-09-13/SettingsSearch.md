# Settings search: localization and retired-state cleanup

The authoritative source is the settings registry, projected by `buildGlobalSettingsSearchGroups` into the sidebar catalog. The catalog incorrectly treated every persisted key as a settings-page control and guessed translation keys from storage names. Its fallback also compared only the qualified translation key, although real i18next returns the unqualified key when a translation is missing. Earlier catalog tests used a translator stub with different missing-key behavior.

This is a catalog-production defect, not malformed user data. The search component does not hide raw-key-looking strings. Registry metadata now identifies live settings with no settings-page control; the catalog excludes those entries at construction. Existing translation keys supply 26 additional label mappings. Tests use real i18next and every locale's resources with language fallback disabled.

## Deleted definitions

| Key                                              | Production trace                                                                                                | Removal                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `general.setupWalkthroughProgress`               | Registry-only retired sidebar-guide state; no production consumer.                                              | Removed registry entry and its now-unused `sidebarGuideProgress.ts` schema/default/type module. |
| `general.githubStarPromptCompleted`              | No production reader or writer.                                                                                 | Removed registry definition.                                                                    |
| `general.githubStarPromptDisabled`               | No production reader or writer.                                                                                 | Removed registry definition.                                                                    |
| `general.githubStarPromptDeferredUntil`          | No production reader or writer.                                                                                 | Removed registry definition.                                                                    |
| `general.githubStarPromptLastShownAt`            | No production reader or writer.                                                                                 | Removed registry definition.                                                                    |
| `general.githubStarPromptNextEligibleValueCount` | No production reader or writer.                                                                                 | Removed registry definition.                                                                    |
| `mobileRemote.desktopToken`                      | Compatibility-only tombstone, retained only by a round-trip test; current relay authentication uses cloud auth. | Removed registry definition and replaced the round-trip expectation with removal coverage.      |

The sweep included source references in TypeScript/TSX and Rust and followed derived atoms to production consumers. A missing direct key reference alone was not treated as proof of dead code.

## Live settings retained outside settings-page search

| Keys                                                                                         | Live owner / reason retained                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `privacy.diagnosticsLevel`, `privacy.diagnosticsUploadIntervalHours`, `privacy.offlineMode`  | `useDiagnosticsBootstrap` consumes these configuration values.                           |
| `privacy.shareRuntimeWithOrg`                                                                | Member-runtime push scheduler consumes the sharing preference.                           |
| `general.chatPanelPosition`, `general.chatTurnPaginationEnabled`, `general.modelPickerStyle` | Sidebar layout menu and corresponding layout/display atoms; no settings-page controls.   |
| `general.userDisplayName`                                                                    | `userDisplayNameAtom` → `useKanbanOrgScope` → Task Kanban creator-name fallback.         |
| `editor.showIndentGuides`                                                                    | `editorShowIndentGuidesAtom` → `useEditorAppearance`.                                    |
| `editor.showBlame`                                                                           | `editorShowBlameAtom` → code-viewer `ContentView`.                                       |
| `terminal.letterSpacing`                                                                     | `terminalLetterSpacingAtom` → terminal surface styling and interactive/output terminals. |
| `mobileRemote.desktopId`                                                                     | Pairing commands generate the identity; Rust relay consumes it.                          |
| `mobileRemote.allowLanExposure`, `mobileRemote.lanToken`, `mobileRemote.lanPort`             | Rust LAN bridge/authentication consumes these values; setup generates the token.         |

These fifteen entries declare `settingsSearch: false` beside their definitions, with a reason. Validation, defaults, JSONC serialization, and runtime readers keep their existing behavior. This implements the user's request to remove search entries that have no settings-page control, without deleting live runtime configuration.

## Source invariants and historical data

- Deleted keys no longer appear in defaults, validated settings, newly generated JSONC, generated JSON Schema, or the search catalog.
- Live configuration remains validated and serializable even when excluded from settings-page search.
- Every emitted label/alias resolves in each of the thirteen locale resource sets. No new translations or language-fallback substitutions were needed.
- Missing-key fallback recognizes both qualified and namespace-stripped i18next responses.

No existing personal settings file was read or rewritten. Old retired entries are ignored by frontend validation on load. Normal partial writes are not a full-file cleanup, so old bytes can remain on disk until the file is explicitly regenerated or cleaned. No automatic disk migration or broad deletion was introduced. If support for an older build is needed, reverting the registry removals restores its definitions; an existing untouched settings file retains its historical values.

## Architecture coverage

| Layer                       | Evidence                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Compilation             | TypeScript and changed-file lint.                                                                                                   |
| 2 — Dead code / duplication | Registry-to-atom-to-consumer trace; seven dead definitions and one unused module removed. Existing translation dictionaries reused. |
| 3 — Naming                  | Storage keys remain distinct from localized labels.                                                                                 |
| 4 — Semantics               | Persisted configuration is not automatically a settings-page control.                                                               |
| 5 — Defaults                | Tests cover defaults/validation and explicit non-page metadata.                                                                     |
| 6 — Boundaries              | Eligibility lives at the registry; rendering contains no string-pattern exclusion.                                                  |
| 7 — Readability             | Each non-page field documents its live owner.                                                                                       |
| 8 — Serialization           | Generated JSONC and JSON Schema are checked for retired keys; no RPC/wire shape or backend changes.                                 |
| 9 — Initialization parity   | Production default/validation/catalog builders are exercised, including historical input and actual i18next behavior.               |
| 10 — Fallback symmetry      | Qualified and unqualified missing keys both take the fallback; supported locale resources must resolve actual indexed labels.       |

Verification commands:

```sh
pnpm test src/config/settingsSearch.test.ts src/config/settingsSchema/__tests__ src/scaffold/NavigationSidebar/variants/settingsSidebarSearchPages.test.ts src/scaffold/NavigationSidebar/variants/SettingsSidebar.search.test.ts
pnpm typecheck:fast
pnpm exec eslint src/config/settingsSearch.ts src/config/settingsSearch.test.ts src/config/settingsSchema/types.ts src/config/settingsSchema/index.ts src/config/settingsSchema/registry/{general,editor,terminal,privacy,mobileRemote}.ts src/config/settingsSchema/__tests__/{mobileRemote,retiredSettings}.test.ts --max-warnings 0
git diff --check
```

Results: **54 tests passed in 12 files**; TypeScript, changed-file ESLint, and `git diff --check` passed.

Live desktop interaction was not run: the user requires explicit opt-in for computer control. No CPU/RAM, polling, subscription, or backend implementation change is claimed by this cleanup.

## Provider setup actions follow-up

The search producer previously modeled only navigation and settings controls. Provider setup is now a separate action kind with a real wizard destination, never a fabricated row reveal. `settingsSetupActions.ts` owns the bounded, typed key-provider entry points and reuses the connection wizard adapter list. It emits localized action copy and provider/intent aliases. Only visible navigation pages receive actions.

The URL parser accepts only explicitly supported providers paired with their owning wizard. Key Vault and connection state consume that intent as initial form selection. Existing Codex reauthentication keeps precedence. Provider-keyed wizard instances prevent stale drafts on provider switches. Unknown intent falls back to the normal picker. Opening setup does not save credentials or start OAuth automatically. Existing user settings are untouched.

Architecture coverage: catalog ownership, types, routing, state initialization, localization and tests. Backend storage/wire, sync, migrations and defaults are unchanged. An explicit list limits key shortcuts to seven supported API providers; generic Add key still opens the normal picker.

Verification: `pnpm test src/config/settingsSetupActions.test.ts src/config/settingsSearch.test.ts src/scaffold/NavigationSidebar/variants/SettingsSidebar.search.test.ts src/scaffold/NavigationSidebar/variants/settingsSidebarSearchPages.test.ts` — 44 passed. Tests cover click-to-wizard paths without reveal callbacks, supported/invalid intent parsing, and labels in 13 locales. `pnpm typecheck:fast` and scoped ESLint passed. Actual credential submission was not exercised.
