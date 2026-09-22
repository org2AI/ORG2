# Shared code typography and selection

## Scope and reference

Terminal, terminal replay, CodeMirror, code blocks, and Tailwind `font-mono`
consume one resolved code-font setting. The default stack uses system fonts:
`ui-monospace`, `SFMono-Regular`, `SF Mono`, Menlo, Consolas, Liberation Mono,
monospace. No font asset is bundled for this default. The terminal uses
normal/bold weights (400/700), zero letter spacing, and 1.2 line height.

ORGII keeps existing font-size and line-height settings. The code editor remains
1.5 by default and the terminal remains 1.2. This change aligns font family and
normal weight, retaining syntax/ANSI emphasis. No settings migration is needed.

Selection highlights also share the chat `--text-selection` color across the
base themes, all generated skins, CodeMirror search matches, diff viewers, and
active/inactive xterm selections. Terminal fallback colors match the base
themes. Syntax colors and semantic diff-add/remove colors are unchanged.

## Architecture review

| Layer                  | Coverage / outcome                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation          | Changed-file ESLint, 53 focused tests, and full typecheck pass on the isolated branch from the latest develop        |
| 2 Deduplication        | Removed the separate terminal resolver; all terminal consumers now read `resolvedCodeFontFamilyAtom`                 |
| 3 Naming               | Removed every `resolvedTerminalFontFamilyAtom` reference                                                             |
| 4 Semantic overloading | Code-font setting consistently covers code and terminal text; application UI font remains a separate setting         |
| 5 Defaults             | System and empty-custom choices use the same stack; explicit presets remain selected                                 |
| 6 Boundaries           | Renderer consumers depend on the existing settings store; no new cross-domain state                                  |
| 7 Clarity              | Shared stack and theme inheritance have local comments                                                               |
| 8 Wire                 | Not applicable: no API, IPC, or persisted schema changes                                                             |
| 9 Initialization       | CSS defaults match runtime resolution; both interactive and read-only xterm initialize with the resolved font        |
| 10 Resolver symmetry   | One resolver owns custom/preset/system fallbacks; dark-theme body declarations no longer override root font settings |

The dark-theme inconsistency was a CSS projection defect: the settings hook
writes font variables on the document root, while body-level defaults shadowed
them. Removing those duplicate body declarations restores inheritance. No
persisted data cleanup is necessary. Regression coverage reads the shipped CSS
and verifies that the root font setting cannot be shadowed by a theme rule.

## Performance guard

| Area               | Verdict | Evidence                                                             | Change or reason kept                                                             | Verification                                              |
| ------------------ | ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Background work    | fix     | XtermOutput font effect owns one animation frame                     | Cancel pending font refit on change/unmount; no recurring work                    | Unmount test asserts no post-disposal fit                 |
| Memory             | keep    | Existing xterm instance, renderer, and WebGL slot remain mount-owned | Update font options and clear glyph atlas in place                                | Font-change test asserts one construction and no disposal |
| Scope/isolation    | keep    | Font is an existing per-store user setting                           | Narrow resolved-font subscription; no remote state or new caches                  | Real Jotai store drives the renderer test                 |
| Rendering/hot path | fix     | Read-only xterm previously omitted fontFamily                        | Apply shared family at mount and on setting change; refit before measuring height | Renderer test checks initial/live font parity and one fit |

### Lifecycle matrix

| State                                     | Expected behavior                                                                   | Evidence                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Mount / clean load                        | Resolve current font before creating xterm                                          | Renderer test                                                 |
| Visible / font setting change             | Patch the existing terminal and schedule one refit                                  | Renderer test                                                 |
| Idle / unrelated streaming                | No new periodic font work                                                           | Effect dependency and call-chain inspection                   |
| Hidden                                    | No recurring font loop; browser frame is one-shot                                   | Source inspection; native hidden-window behavior not measured |
| Unmount / close                           | Cancel pending font frame; existing terminal disposal remains owned by mount effect | Unmount test                                                  |
| Multiple stores / windows                 | Existing Jotai store supplies each renderer; no added module-global mutable state   | Source inspection; native multi-window exercise not run       |
| Network / identity / provider transitions | No changed resources or behavior                                                    | Not applicable                                                |

## Verification

Focused tests on the isolated PR branch: **53 passed across 11 files**. ESLint, formatting, stylesheet
compilation, and diff whitespace checks passed. Vitest emitted the existing
jsdom canvas-not-implemented notice; native rendering is not covered by these tests.

- `pnpm test src/store/ui/__tests__/editorSettingsAtom.test.ts src/config/appearance/skins/deriveSkinTokens.test.ts src/config/appearance/skins/rootAliasParity.test.ts src/engines/TerminalCore/components/TerminalInteractive/utils/theme.test.ts src/util/ui/theme/__tests__/selectionTokenParity.test.ts src/engines/ChatPanel/ChatHistory/selectionStyles.test.ts src/features/CodeMirror/config/themeConfig.test.ts src/features/CodeMirror/Diff/reviewSearchNavigation.test.ts src/engines/TerminalCore/components/XtermOutput/XtermOutput.test.ts src/engines/TerminalCore/__tests__/TerminalCore.test.ts src/components/MarkDown/markdownLinkCodeStyles.test.ts` — 53 passed
- ESLint on all changed TypeScript files; Prettier on changed files
- Compiled Tailwind with PostCSS and asserted `.font-mono` emits `font-family: var(--code-font-family)`; compiled the changed Markdown, code-viewer, and diff SCSS with Sass
- `pnpm typecheck:fast` — passed
- `git diff --check`

Pure styling and font wiring introduce no new action controls. Source inspection
of the changed JSX confirms no raw-button or input bypass. Frontend UI audit is
skipped under its pure-styling exclusion; no component structure changed.

Native visual checks and CPU/RSS measurements were not run: computer control was
not authorized. No runtime performance improvement is claimed. Font metrics can
change wrapping/terminal columns, and actual glyph appearance depends on the
platform. Existing font settings let users restore Hack explicitly.

Performance verdict: blocked for native measurement. Focused lifecycle evidence covers the changed font effect.
