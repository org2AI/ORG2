# Architecture audit — dead code & duplicate components (2026-09-20)

Scope: `src/**` TypeScript/TSX only (7,753 files). `src-tauri/**` (Rust) not covered
in this pass. Audit-only: no source files were modified.

Method (Layer 2 of `architecture-audit`, call-chain tracing rather than grep counts):

1. `knip` (`config/knip.json`) for unused exports/types/files.
2. A purpose-built import-graph walk over every `src` file, resolving `@src/`, `@/`,
   `@api/`, `@common/`, `@page/`, `@assets/`, relative paths, bare side-effect imports
   (`import "x";`), `import()` with webpack magic comments, and `new URL("./w.ts", import.meta.url)`
   worker references. Barrels are classified structurally (a file is a barrel only if it
   contains _nothing but_ re-exports), and names a barrel exposes (`export { default as X }`)
   are propagated back to the implementation module before judging it dead.
3. Token-shingle near-duplicate detection across all 1,812 non-test `.tsx` files
   (6-token shingles, Jaccard + containment).
4. Repeated-block clone detection (6-line normalized windows appearing in ≥4 files).

False-positive classes that this method now handles, and that a naive scan gets wrong:
side-effect-only imports (`storage/cleanup`, `browserModeShim`, `WorkStation/actions/install`),
workers loaded through `new URL`, registry self-registration (`registerTabSidebar`),
lazy routes behind `/* webpackChunkName */`, and implementation modules reached only through
a renaming barrel.

## Status

| Finding                                       | Outcome                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| §1.2 mobile Stop regression                   | Fixed — org2AI/ORG2#2030 (and it was worse than first written: see the correction in that section)          |
| §1.1 `isValidSessionUUID`, sidebar re-exports | Removed — org2AI/ORG2#2031                                                                                  |
| §1.1 `src/contracts/agent/index.ts`           | **False positive**, see the row below — not removed                                                         |
| §2.1 per-channel forms and configs            | Consolidated — org2AI/ORG2#2032 (−1,620 lines; the "one table" premise was wrong, see the correction there) |
| §2.3 refresh / delete icon buttons            | Swept — org2AI/ORG2#2033 (18 refresh sites + all 10 delete sites; 33 refresh sites deliberately kept)       |
| §2.2, §2.4, §2.5, §2.6                        | Open                                                                                                        |

Two findings changed under contact with the code. Both corrections are recorded in
place below rather than quietly edited away, because the wrong version of each is
the kind of thing a later audit would re-derive.

---

## 1. Dead code

### 1.1 Confirmed dead — safe to delete

| File / symbol                                                                                                                                 | Lines | Evidence                                                                                                                                                                                                                                                                                                                                                                                                     | Verdict                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/modules/MobileRemote/components/modals/StopConfirmModal.tsx`                                                                             | 88    | Only references anywhere are two stale `vi.mock(...)` stubs in `MobileRemoteApp.search.test.ts` / `MobileRemoteApp.drafts.test.ts`. No production render site.                                                                                                                                                                                                                                               | **fix** — see 1.2, this is a symptom, not just dead code                                            |
| ~~`src/contracts/agent/index.ts`~~                                                                                                            | 6     | **FALSE POSITIVE (resolved 2026-09-20).** `src/contracts/README.md` §Layout mandates "one directory per domain, each with an `index.ts` barrel" and "import from the domain barrel, not from a file inside it"; 13 of 14 contract domains carry one. knip cannot see a convention. The real defect is the inverse: 3 consumers deep-import `@src/contracts/agent/rustAgentType` against the documented rule. | **keep with reason** — barrel is the convention; deep imports are the follow-up                     |
| `isValidSessionUUID` — `src/store/session/sessionAtom/helpers.ts:13`                                                                          | 19    | Exported through `sessionAtom/index.ts`; the only consumer is `store/session/__tests__/sessionManagerAtom.test.ts`, which tests it directly. Classic definition + re-export + test chain.                                                                                                                                                                                                                    | **fix** — delete helper and its test block, or wire it into the session-id guard it was written for |
| `TerminalTabSidebar` export chain — `.../SidebarModules/Terminal/TerminalTabSidebar.tsx` → `Terminal/index.ts` → `SidebarModules/index.ts:22` | —     | The module is **alive** (it self-registers via `registerTabSidebar("terminal", …)` at module scope), but the named export is imported by nobody. Same for `SourceControlTabSidebar` (`SidebarModules/index.ts:16`).                                                                                                                                                                                          | **fix (export only)** — drop the re-export, keep the side-effect import                             |

### 1.2 Dead code that is actually a regression (P0)

The mobile Stop-confirmation flow is half-removed:

- `src/modules/MobileRemote/navigation/useMobileRemoteCoordinator.ts` still owns the
  state machine — `stopConfirming` (L50), `setStopConfirming` at L57/70/142/154,
  `handleConfirmStop` (L138), `stopFailed` (L51) — and returns all of it (L202–209).
- `src/modules/MobileRemote/MobileRemoteApp.tsx:39–51` no longer destructures
  `stopConfirming`, `stopFailed` or `handleConfirmStop`. Nothing renders the modal.
- `stopConfirm.title` / `stopConfirm.body` still exist in all locales
  (`src/i18n/locales/*/mobileRemote.json:247`) and `mobileI18n.test.ts` still asserts them.

`git log -S "StopConfirmModal" -- src/modules/MobileRemote/MobileRemoteApp.tsx` points at
**f46920cb90** (`feat(mobile-remote): prepare current iOS experience for TestFlight`) as the
commit that dropped the render site. That is the same squashed commit already flagged for
carrying an open PR's content into develop.

**Correction (2026-09-20, during the fix): the regression is wider than stated above.**
f46920cb90 removed not just the modal but the entire Stop affordance — `SessionChatScreen` lost its
top-bar Stop button too. `git grep "open_stop_modal" HEAD -- src/modules/MobileRemote` shows the
action dispatched **only from test files**; no production code path reached `handleConfirmStop` or
`stopSession`. So the user-visible symptom was "mobile remote cannot stop a running task at all",
not "Stop skips its confirmation". Corroboration from this same audit: `src/assets/icons/StopCircleIcon.ts`
showed up as a dead module reachable only through `src/icons.ts` — it was dead precisely because the
button that used it had been deleted.

Resolved: the Stop control and its confirmation were restored at the render boundary (see
`MobileRemoteApp.stop.test.ts`, which drives the real coordinator, top bar and modal — a
coordinator-only test is what let this escape).

### 1.3 Export-level dead weight (not file-level)

knip reports **955 unused exports + 231 unused exported types**; 444 of the unused exports are
in `index.*` barrels — i.e. the barrels publish far more than anything imports. Highest
concentrations outside barrels:

| Unused exports | Area                                                               |
| -------------- | ------------------------------------------------------------------ |
| 84             | `src/api/tauri`                                                    |
| 67             | `src/modules/WorkStation`                                          |
| 39             | `src/engines/ChatPanel`                                            |
| 38             | `src/modules/ProjectManager`                                       |
| 28             | `src/engines/SessionCore`                                          |
| 26             | `src/features/Org2Cloud`                                           |
| 13             | `src/contracts/mobile-relay/v1/relay.ts` (13 of 20 exports unused) |

`pnpm check:unused-exports` already runs this. The barrel-published-but-unimported surface is
the thing to sweep; it is what hides genuinely dead modules from file-level detection.

### 1.4 Verified _not_ dead (do not re-flag)

`src/util/core/storage/cleanup.ts`, `src/util/platform/browserModeShim.ts`,
`src/modules/WorkStation/actions/install.ts` (bare side-effect imports from `index.tsx` / `App.tsx`);
`ChatHistory/projection/worker.ts`, `DiffSectionList/search/reviewSearch.worker.ts`
(`new Worker(new URL(…))`); `*.testUtils.ts` / `*.test-utils.ts` /
`config/settingsSchema/assertSettingsUiParity.ts` (legitimate test helpers);
`features/GitDialogs/BranchSwitchQuestion.tsx` (imported by `services/git/operations/*`).

---

## 2. Duplicate components / consolidation opportunities

Ordered by payoff. Line counts are current.

### 2.1 Per-channel forms and configs — ~3,300 lines of table data written as components (P1)

| Cluster                                                                     | Files | Lines |
| --------------------------------------------------------------------------- | ----- | ----- |
| `src/scaffold/WizardSystem/variants/Channel/SetupForms/*Form.tsx`           | 16    | 1,235 |
| `src/modules/MainApp/Integrations/Connections/Channels/configs/*Config.tsx` | 16    | 2,081 |

Pairwise containment runs 0.88–0.96 inside each cluster. Every file is the same
`SectionContainer > SectionRow > Input` loop; only the field key, i18n label key and
placeholder differ. `DiscordForm` vs `TelegramForm` differ by exactly one extra row.

Worse, the _same 16 channels are described twice_ — once flat (`config` / `onChange`), once
nested (`getNestedString(config, "${pathPrefix}.token")` / `update(path, …)` with
`parseCommaSeparated` for list fields).

Suggested shape: one `CHANNEL_FIELDS: Record<ChannelKind, ChannelField[]>` descriptor
(`{ key, labelKey, descKey?, placeholder, required?, kind: "string" | "stringList" | "secret" }`)
plus two thin renderers over a value-accessor adapter (flat vs path-prefixed). 32 files → 1 table

- 2 renderers; ~2,800 lines removed, and a new channel becomes one table row instead of two files.

**Correction (2026-09-20, from doing it — org2AI/ORG2#2032): "the same 16 channels described
twice" is only half right, and one table would have been a behaviour change.** The two surfaces
are not the same field list: settings exposes strictly more fields per channel (Matrix 8 rows vs
the wizard's 5; Feishu 9 vs 4), carries a `Desc` key per row where the wizard carries `required`
markers, persists list fields as `string[]` where the wizard posts the raw comma string, and
differs on placeholder and password flags for the same field (Feishu `appSecret` is plain in the
wizard, `type="password"` in settings). What shipped is one descriptor type and one renderer
concept over **two** tables — `CHANNEL_WIZARD_FIELDS` and `CHANNEL_SETTINGS_GROUPS`. Net −1,620
lines rather than the ~2,800 estimated here, because the estimate assumed a merge that would have
silently changed ~10 channels.

The lesson for this method: containment scores of 0.88–0.96 prove the _shape_ is duplicated. They
say nothing about whether the two shapes are allowed to diverge, and that question can only be
answered by reading both call sites.

### 2.2 ChatPanel header-only blocks (P2)

`SearchBlock` (99), `GlobBlock` (100), `ListDirBlock` (106), `SkillBlock` (96) are clones of
`TitleOnlyBlock` (102), which is already documented as _the_ generic header-only block.
Diffing `SearchBlock` against `GlobBlock` with names normalized leaves only: which
`getToolIcon(...)` is called, and whether a `<FileTypeIcon>` prefixes the subtitle.

Both differences belong in the adapters that already exist
(`rendering/adapters/{Search,Glob,…}Adapter.tsx`). Add `subtitlePrefix?: React.ReactNode` to
`TitleOnlyBlock`, route the four block types to it, delete ~400 lines.

Separately, 18 files repeat the identical `useBlockHeader` destructure and 14 repeat the same
`EventBlockHeader` prop wiring (`onNavigate/onMouseEnter/onMouseLeave/rightContent={toolUsage ? <ToolUsageBadge/> : undefined}`).
A `BlockHeaderShell` primitive in `blocks/primitives/` would absorb that.

### 2.3 Controls that already exist in `src/components/` but are hand-rolled elsewhere (P1)

| Existing component                                           | Hand-rolled copies                                                                                                                                                               | Detection          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/components/Button/RefreshButton.tsx` (used by 25 files) | **50 files** render `icon={<HugeiconsIcon icon={Refresh04Icon} data-icon="refresh-cw" size={14} …>}` inside a `Button` without importing it                                      | exact-pattern scan |
| — (none yet)                                                 | **10 files** render the same danger delete button (`Delete02Icon`, `size={14}`, `text-danger-6`)                                                                                 | clone cluster      |
| `src/components/Placeholder`                                 | 12 files declare their own `const LazyFallback = () => <Placeholder variant="loading" placement="detail-panel" fillParentHeight />`; 8 more inline it in `<Suspense fallback=…>` | clone cluster      |

The refresh one is the highest-value sweep: it is the same visual control, and per the
2026-09 refresh-spin work the spin behaviour is supposed to come from `useRefreshSpin` inside
`RefreshButton`. 50 hand-rolled copies means 50 buttons that silently miss that behaviour.
Recommend a config-level sweep (one PR, mechanical), not site-by-site fixes.

**Outcome (org2AI/ORG2#2033): 18 of the 50 migrated, not all 50.** The remaining 33 are genuine
keeps — menu rows rather than buttons, icons at 10/12/13/16/20px, token-driven panel-header
geometry, `variant="primary"` (which `RefreshButton` does not offer), `persistenceKey` usage, and
three controls that are not refreshes at all. Two lessons: a pattern count from a regex is an
upper bound on a sweep, not its size; and the sweep is not free of behaviour — `useRefreshSpin`
defers `onRefresh` by one `requestAnimationFrame`, which is invisible to users but turned one
site's tests red, so that site was left alone.

Suggested new `src/components/` additions: `DeleteIconButton` (or a `tone="danger"` preset on the
existing icon button) and `LazyDetailFallback`.

### 2.4 WorkStation tab renderers (P2)

`src/modules/WorkStation/TabContent/renderers/gitCommitDetail.tsx` (53) and
`gitStashDetail.tsx` (50) are **character-for-character identical** apart from the component
name and the doc comment — both lazy-load `GitCommitDetailContent` and pass the same props.
Map both tab types to one renderer.

Across the 19 renderers in that directory the same skeleton repeats: `React.lazy(() => import(…))`

- `LazyFallback` + `memo` + `displayName`. A `createLazyTabRenderer({ load, mapProps })` factory
  removes most of 2,551 lines of wrapper.

### 2.5 Org2Cloud REST clients (P2)

10–11 files under `src/features/Org2Cloud/` (`channelsClient`, `channelMessagesClient`,
`memberRuntimeClient`, `org2CloudCommentsClient`, `org2CloudConversationEventsClient`,
`org2CloudConversationTurnClient`, `org2CloudManagementClient`, `org2CloudProjectsClient`,
`org2CloudSharesClient`, `teamInboxMentionsClient`, …) repeat the identical
`fetchWithTransportRetry(${supabaseUrl}/rest/v1/rpc/${fn}, { POST, apikey, authorization, content-profile })`
→ `await response.text()` → guarded `JSON.parse` → `payload.message ?? "org2_cloud rpc … failed with ${status}"`
block. No shared helper exists (`grep` for `callOrg2CloudRpc`/`postgrestRpc` finds none).
Extract one `callOrg2CloudRpc(functionName, body, { signal })`.

### 2.6 Smaller clusters (P3)

| Cluster                                                                                                                                  | Files  | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InlineExternal{Mcp,Rules,Agents,Skills}Import.tsx`                                                                                      | 4      | Each is a 34–40 line wrapper over `InlineExternalImport` differing only in `kind` + 4 label keys → one `kind → labels` map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~`CollapsibleSection.tsx`~~                                                                                                             | 3      | **FALSE POSITIVE (resolved 2026-09-20).** The shared part was already harvested on purpose: `src/hooks/ui/useCollapsible.ts:23` says in its own docstring that it was "Extracted from the three duplicated `CollapsibleSection` components". What remains is three different components wearing one noun. `PrimarySidebarLayout`'s is a resizable flex panel section — controlled collapse, `flexGrow`/`flexBasis`, a drag handle, action _descriptors_, and a context portal letting the body mount header buttons — and cannot use `useCollapsible` at all. The DevTools one is a 12px uppercase inspector section driven by `collapseAllKey`/`expandAllKey` toolbar signals, with its badge **inside** the toggle target; unifying it onto the `components/` one needs 3+ new props, an interaction change, and a class-composition rewrite (the shared one concatenates class strings with no `tailwind-merge`, so header tokens can only be fought, not replaced). All three kept; the DevTools collapse-all behaviour is now covered by a test. Two traps found while reading: `SourcePanel` reaches across into `../DesignPanel/CollapsibleSection`, and that component's `collapseAllKey` effect fires on mount, so a future caller passing only `collapseAllKey` would start collapsed despite `defaultOpen`. |
| `features/LocalChannels/components` vs `features/Org2Cloud/channels/components`                                                          | 4 + 4  | The same four dialogs (`Archive`, `Create`, `Delete`, `Settings`) exist once for local channels and once for cloud channels; measured overlap is strongest on `Delete*` (0.59 containment). Cloud adds `ManageChannelMembersDialog`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `features/GitDialogs/*`                                                                                                                  | 6 of 7 | `DetachedHead`, `LargePushConfirm`, `ProtectedBranch`, `PullConflict`, `PushRejected`, `RebaseConflict` each wrap one `message()` call in their own `class …DialogManager`, **all with hardcoded English strings and zero i18n**. `CheckoutConflictDialog` is the modern in-app one and does use `useTranslation`. One `createNativeChoiceDialog({ titleKey, bodyKey, buttons })` factory fixes the duplication and the i18n gap together                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scaffold/Tutorials/{CodeEditorTour,GeneralLayoutTour}.tsx`                                                                              | 2      | 442/468 lines, 0.84 containment — step arrays wrapped in identical machinery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SessionSetup/components/{Codex,ClaudeCode,Cursor,Copilot}SessionSetup` and `WizardSystem/variants/KeyVault/components/setup/*Setup.tsx` | 4 + 5  | Per-provider setup panels; `OAuthSessionSetupShell` already exists as the seam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `modules/MainApp/**/Table/*Table.tsx`                                                                                                    | 9      | Same `columns = () => [{ key: "name", label: t("common:labels.name"), width: SETTINGS_TABLE_COL.fill, sorter … }]` prologue → a `nameColumn()` helper                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Pagination state type                                                                                                                    | 5      | `{pageIndex,pageSize,total,pageCount,canPreviousPage,canNextPage}` redeclared in `components/SettingsTable` (×2), `components/Table` (×2), `features/GitHubWork`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `engines/DatabaseCore/providers/*`                                                                                                       | 5      | Identical `insert/update/delete` SQL builders per provider → base class                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `FilePreviewContent/{Docx,Image,Pdf,Pptx,Video,Xlsx}Preview`                                                                             | 6      | Same error/loading `Placeholder` shell → one preview frame                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `components/SearchInput` vs `CodeEditor/Panels/shared/ReplaceInput`                                                                      | 2      | 0.67 containment; Replace is a superset of Search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `NavigationSidebar/components/SidebarChromeIconButton` vs `components/TabPill/TabBarTrailingIconButton`                                  | 2      | Same 14px chrome icon button, two homes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## Sweep discipline

Per the skill's `Systematic Sweep Discipline`: 2.3 (refresh button, 50 sites) and 2.1 (channel
tables) are config-level changes, not site-by-site fixes — they should land as their own scoped
PRs rather than being patched opportunistically inside unrelated work. 1.2 is a behaviour
regression and should be decided and fixed independently of any cleanup.
