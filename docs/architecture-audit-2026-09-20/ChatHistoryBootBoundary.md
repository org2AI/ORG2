# Chat history boot loading boundary

## Problem and evidence

Nightly run https://github.com/org2AI/ORG2/actions/runs/35545727680 failed
on develop `6d1f6bac438eda2f849d924db8932afea0f5be39`: 2,992 source JavaScript
modules exceeded the unchanged 2,850-module boot budget. The preceding nightly
https://github.com/org2AI/ORG2/actions/runs/35477237913 already exceeded that
budget (2,969 modules). This is separate from the OAuth refresh fixes.

Both ChatViewHistorySurface and SideChat statically reached the complete
ChatHistory renderer through its public entry, including projection, navigation,
and transcript rendering code. The same entry is used by Simulator's
SubagentChatPane. The public entry now owns one module-scope React.lazy import
and a local Suspense boundary using the existing ChatLoadingBlock. The previous
renderer is moved byte-for-byte to ChatHistory.tsx. No caller, provider, stored
state, subscription implementation or budget threshold changes. The existing
typed-lint finding for the moved renderer follows its new path; its rule,
expression and allowed count remain unchanged.

## Acceptance and measurement

Production webpack stats, using the existing budget script without changes:

| Measurement            |    Before |     After |    Budget |
| ---------------------- | --------: | --------: | --------: |
| Boot source JS modules |     2,992 |     2,822 |     2,850 |
| Boot JS bytes          | 6,544,431 | 6,242,588 | 6,600,000 |
| Boot chunks            |        38 |        37 |         — |

The deferred renderer is absent from the boot chunk group. The existing CI gate
continues to check the real production graph. Only 28 modules of headroom remain;
this fix does not imply future additions can bypass the budget.

First use now loads a chunk and displays a static skeleton. A rejected chunk
propagates to the existing owning error boundary. Loaded code is cached by the
module runtime, while each mounted reader retains its own state. A restored
session that renders immediately still needs the renderer; these measurements
are the boot chunk group, not total bytes eventually loaded for every route.

## Architecture review

| Layers                                        | Result                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1: Compilation                                | Production build, TypeScript and changed-file lint pass                                                        |
| 2: Duplication                                | One shared boundary covers main chat, side chat and simulator; no duplicated loading implementation            |
| 3–4: Naming and semantics                     | Public ChatHistory props/type export remain compatible; implementation separated from lazy entry               |
| 5: Defaults                                   | All renderer defaults remain byte-identical; pending load has a local placeholder; errors propagate            |
| 6–7: Domain boundaries and discoverability    | Lazy entry owns only loading; transcript state/effects remain in renderer; entry comment explains the boundary |
| 9: Entry parity                               | Runtime import sweep finds all three consumers still using the public entry; type-only consumers remain erased |
| 8 and 10: Wire protocol and resolver symmetry | Skipped: no protocol, persistence, identifier, or resolver change                                              |

Frontend UI audit is not applied: its exclusions explicitly route performance
work to react-best-practices. No action controls or form fields are introduced;
the loading surface reuses the existing shared skeleton and utility spacing.

## Performance and lifecycle review

| Area               | Verdict | Evidence                                                   | Change or reason kept                                                             | Verification                                                                  |
| ------------------ | ------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Background work    | keep    | Renderer hooks/effects are unchanged                       | Effects start at reader mount and clean up at unmount; no timer or prefetch added | Existing renderer byte comparison; mounted/unmounted reader test              |
| Memory             | fix     | 170 fewer boot source modules; 301,843 fewer boot JS bytes | One lazy module per realm, no custom retained cache                               | Production stats; import executes once across two readers                     |
| Scope/isolation    | keep    | Session context/props belong to callers                    | No captured session in asynchronous import                                        | Test switches context and closes side reader before chunk resolves            |
| Rendering/hot path | keep    | Boundary is outside unchanged renderer                     | Existing reader survives prop/context changes; fallback stays local               | DOM tests verify loading, latest props/context, cleanup and error propagation |

Performance verdict: pass for the measured boot graph and tested loading
boundary lifecycle. Native Tauri first-open latency, visible/hidden CPU/RSS,
scroll restoration and real multi-window interaction were not measured; no
runtime speed or memory improvement is claimed from bundle size alone. These
remain manual acceptance gaps rather than evidence of full runtime validation.

## Verification

All commands ran in the isolated branch based on develop:

- `NODE_OPTIONS=--max-old-space-size=6144 pnpm build:stats`: passed before and after; baseline reproduced CI failure.
- `pnpm check:bundle-budget`: baseline failed at 2,992; modified build passed at 2,822.
- `pnpm test src/engines/ChatPanel/ChatHistory`: 59 files, 571 tests passed, including two new DOM loading-boundary tests.
- `pnpm typecheck:fast`: passed.
- `pnpm exec eslint src/engines/ChatPanel/ChatHistory/index.tsx src/engines/ChatPanel/ChatHistory/ChatHistory.tsx src/engines/ChatPanel/ChatHistory/lazyBoundary.test.ts --max-warnings 0`: passed.
- `pnpm exec oxlint -c src/.oxlintrc.json --max-warnings 0 src/engines/ChatPanel/ChatHistory/index.tsx src/engines/ChatPanel/ChatHistory/ChatHistory.tsx src/engines/ChatPanel/ChatHistory/lazyBoundary.test.ts`: passed.
- `NODE_OPTIONS=--max-old-space-size=6144 pnpm check:typed-lint`: passed with 1,055 existing findings and zero new or increased findings after relocating the unchanged renderer finding.
- `pnpm test:typed-lint`: all 6 tests passed.
- `git diff --check`: passed.
- Compared the moved renderer against the original Git blob: byte-identical.

Full frontend suite, native Tauri and screenshots were not run. No normal-state
visual design changed; the loading fallback reuses an existing component and is
DOM-tested. No Rust code changed. Rollback is restoring the original public
entry and removing the new implementation/loading tests; there is no data
migration.
