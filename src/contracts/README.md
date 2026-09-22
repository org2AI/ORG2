# `src/contracts/` — the cross-tier shape layer

`contracts/` is the bottom of the dependency graph. It owns the **shapes** that
two or more tiers have to agree on, so that a leaf (`store/`, `types/`, `api/`,
`util/`, `config/`) never has to reach **up** into `components/`, `engines/`,
`features/`, `scaffold/` or `modules/` just to name a type.

## The rule

> When an atom and a surface share a shape, the shape moves **down** into
> `contracts/`. The atom never moves up.

The surface keeps its public API by re-exporting the shape from its original
module, so existing importers are unaffected:

```ts
// src/engines/SessionCore/conversations/conversationTypes.ts
export * from "@src/contracts/conversation/conversationTypes";
```

## What belongs here

- Types, interfaces and unions shared across two or more tiers.
- `const` maps / `as const` tuples that exist only to derive those unions
  (`DATABASE_TYPES`, `WORK_ITEM_HISTORY_ACTION`, …).
- Enums and pure type guards / key functions that are part of the shape's
  definition and depend on nothing but the shape itself
  (`isLocalConversationTarget`, `conversationRootKey`).
- Wire/protocol definitions generated from a backend schema
  (`mobile-relay/v1/`).

## What does not belong here

- Anything with a **runtime dependency**: React, jotai atoms, Tauri `invoke`,
  the network layer, module-level mutable state, caches, loggers, i18n.
- Anything that reads or writes application state.
- Presentation concerns (class names, colors, icons) — those stay in `config/`
  or with the component.
- A shape only one tier uses. It belongs with its owner, not here.

## The hard constraint

**Nothing in `src/contracts/` may import from any other `src/` directory.**
Only other `contracts/` modules and third-party packages (type-only, ideally
none at all). This is what makes `contracts/` a true leaf and keeps the graph
acyclic.

Check it with:

```bash
grep -rnE 'from "(@src/|@/src/|@api/|@common/|@page/|@assets/)' src/contracts/ \
  | grep -v 'from "@src/contracts/'
# must print nothing
```

The only third-party import in the layer today is the type-only
`import type { Store } from "jotai/vanilla/store"` in
`conversation/queuedConversation.ts`, which types the dispatcher seam. Keep
that list at zero or one: a contract that needs a runtime package is not a
contract.

Within one domain use a relative import (`./conversationTypes`); across
domains use the absolute path (`@src/contracts/session/execMode`).

If a shape you want to move pulls in a type from `api/` or `store/`, either
move that type down too, or leave the shape where it is — do not add an upward
import here to make it fit.

## Layout

One directory per domain, each with an `index.ts` barrel:

```
contracts/
  channels/      cloud channel vocabulary
  chat/          chat-panel block payloads
  composer/      composer editor snapshot shapes
  conversation/  canonical-conversation locators + targets
  database/      database connection configuration
  git/           git status + streaming error vocabulary
  github/        GitHub REST/Tauri shapes
  mobile-relay/  generated relay wire protocol (do not hand-edit)
  notification/  notification sound vocabulary
  project/       project / work-item domain records
  session/       session creator, permission, ADE shapes
  simulator/     simulator app + subagent shapes
```

Import from the domain barrel (`@src/contracts/conversation`), not from a file
inside it, unless you need a single type from a large domain.
