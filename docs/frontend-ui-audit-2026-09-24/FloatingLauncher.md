# FloatingLauncher UI audit

| Line                                                              | Element                | Verdict          | Reason                                                                                                                                                   | Suggested change |
| ----------------------------------------------------------------- | ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/FloatingWindow/FloatingLauncher.tsx:23`           | Circular corner action | keep with reason | Shared Button owns dimensions, appearance, focus and native keyboard behavior; label supplies both tooltip and accessible name. No native-button bypass. | None             |
| `src/components/FloatingWindow/FloatingLauncher.tsx:41`           | Corner stack           | keep with reason | One layout owns the corner inset and gap using existing utilities; DOM order matches visual and keyboard order. Empty children occupy no slot.           | None             |
| `src/engines/ChatPanel/SideChat/index.tsx:149`                    | Floating Chat trigger  | keep with reason | Reuses FloatingLauncher; contributes a node to the parent layout instead of knowing Workstation state or offsets.                                        | None             |
| `src/engines/ChatPanel/SideChat/index.tsx:160`                    | Header Chat trigger    | keep with reason | Shared Button preserves the intentionally smaller header size and existing portal destination.                                                           | None             |
| `src/scaffold/WorkbenchChrome/WorkstationFloatingControls.tsx:82` | Workstation trigger    | keep with reason | Reuses FloatingLauncher; domain action and translated label remain owned by Workstation.                                                                 | None             |
| `src/scaffold/AppLayout/AppLayout.tsx:389`                        | Launcher composition   | keep with reason | AppLayout composes independent launchers in one stack; Settings still hides both. The render slot runs even when Chat supplies no trigger.               | None             |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

## Contract and architecture review

Scope: shared launcher appearance and corner placement only. Geometry hooks and domain state machines are unchanged. Shared components import no Chat or Workstation state. AppLayout owns ordering; Sidechat owns its visibility and header destination; Workstation owns expand/collapse. No new persisted facts, subscriptions, timers, caches or async boundaries are introduced.

Architecture checklist: layers 1–7 cover types, duplication removal, naming, default standalone stack, domain isolation and component boundaries; layer 9 checks standalone and AppLayout composition. Layers 8 and 10 have no changed wire/serialization or resolver contracts. Existing native-window lifecycle and drag geometry remain outside this refactor.

## Behavioral matrix and verification

- Both minimized: Chat above Workstation in one stack.
- Chat opens: its trigger disappears, Workstation remains the same DOM node.
- Chat closes: its trigger returns; Workstation restores independently without changing Chat state.
- Narrow detail header: the existing header-host test verifies one Chat trigger moves between header and corner.
- Settings: existing AppLayout render gate still hides both entries.
- No parent renderer: Sidechat uses the shared stack itself.

Checks: focused launcher/header/workstation suite (5 files, 8 tests); TypeScript; scoped ESLint; diff whitespace inspection. Controls were inspected as JSX: shared Button or a wrapper built on it, no new raw buttons or clickable substitutes. No new native desktop screenshot or native webview stacking verification was performed for this refactor; those remain runtime verification limits.
