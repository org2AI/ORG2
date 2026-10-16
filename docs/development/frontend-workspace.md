# Frontend workspace

The frontend is a pnpm workspace with the application at the repository root
and reusable code in private packages. The desktop, web remote, and iOS remote
frontend entries keep their existing locations and build commands.

```text
package.json                         orgii application and workspace commands
src/                                 application, platform adapters, UI, stores
packages/
  replay-core/                       @orgii/replay-core
  terminal-shell-integration/         @orgii/terminal-shell-integration
config/
  tsconfig.package.json              shared strict package compiler settings
  vitest.package.ts                  isolated package test configuration
  frontend.workspace.ts              application + package test projects
```

## Ownership and imports

The application declares package dependencies with `workspace:*`. Consumers
import `@orgii/replay-core/shell`, `@orgii/replay-core/timeline`, or
`@orgii/terminal-shell-integration`. Packages may not import application code,
including application-owned types. Cross-package imports must use declared
public exports; relative paths into another package's source are rejected.

`replay-core` owns terminal frame/watermark processing, bounded cache classes,
request generation guards, and timeline algorithms. The application owns the
shared cache instance in `src/engines/SessionCore/replay/shellReplayCache.ts`,
the RPC transport, and React subscriptions. Importing the package does not
create a cache instance or start a timer.

`terminal-shell-integration` owns the xterm OSC 633 addon and its callbacks.
Each addon owns its registrations and releases them on dispose. The application
continues to create/dispose terminals and the Rust backend still supplies shell
integration scripts. The package declares xterm as a peer dependency.

## Source exports and builds

These are **private frontend packages**, not packages published to npm. Their
`exports` point to TypeScript source so webpack, Rspack, Vitest, and TypeScript
all read the same implementation. Both application bundlers resolve workspace
symlinks to the real package files, compile them with the existing loaders, and
can observe edits without a separate package build watcher. Do not add app aliases
that bypass the package's exports.

Each package has an independent `tsconfig.json`, `tsconfig.build.json`, and
`vitest.config.ts`. `build` emits ESM JavaScript and declarations into its ignored
`dist/` directory. The application consumes source directly; it never depends on
stale dist output. Direct execution in Node or public npm distribution is not a
supported package contract; either would need a deliberate output/export design.

The root application and both packages are marked `private`. Licensing remains
AGPL-3.0-or-later. No package publishing credentials or publishing workflow is
needed for this workspace.

## Commands

| Command                                  | Coverage                                                           |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`         | Install/link all workspace members                                 |
| `pnpm typecheck` / `pnpm typecheck:fast` | Independent package checks, then application tsc/tsgo              |
| `pnpm build:packages`                    | Build both package artifacts in dependency order                   |
| `pnpm build`                             | Build packages, then the existing production application           |
| `pnpm test`                              | Application and package test projects, including path/name filters |
| `pnpm test:app`                          | Application tests with the existing platform mocks                 |
| `pnpm test:packages`                     | Package tests without application setup                            |
| `pnpm --filter @orgii/replay-core test`  | One package's test suite                                           |
| `pnpm lint`                              | Application and package sources                                    |
| `pnpm check:boundaries`                  | Existing app rules plus package ownership/public-entry rules       |
| `pnpm check:circular`                    | Application and package dependency cycles                          |
| `pnpm check:test-placement`              | Test placement in all frontend source roots                        |
| `pnpm test:workspace`                    | Actual package entry compilation with application bundlers         |

Root coverage includes package source. The separate `tests/e2e` WebDriver
project retains its own install and test commands. Tooling tests remain explicit
Node suites. Mutation tests keep their dedicated configuration and scope.

## Adding a package

Create `packages/<name>/package.json` with a unique name, `private: true`,
explicit source exports, and its own dependencies. Add its `workspace:*`
dependency to consumers and regenerate the lockfile without upgrading unrelated
dependencies. Use another package's TypeScript and Vitest configuration as a
starting point; the root workspace discovers `packages/*/vitest.config.ts`.

Move the real implementation and its behavior tests together, then update all
production consumers. Keep application side effects behind explicit adapters.
Do not leave a second implementation or a path-only compatibility barrel.
Run the package checks, relevant application tests, and dependency gates. Build
and exercise a real consumer before treating a new package as integrated.
