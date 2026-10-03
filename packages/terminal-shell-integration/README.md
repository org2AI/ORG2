# @orgii/terminal-shell-integration

Private xterm addon for the ORGII frontend's OSC 633 shell integration.

```ts
import { ShellIntegrationAddon } from "@orgii/terminal-shell-integration";

terminal.loadAddon(
  new ShellIntegrationAddon({
    onCommandFinished: (exitCode) => recordExitCode(exitCode),
  })
);
```

The addon reports prompt, command, exit-code, and working-directory changes.
Each instance owns its registrations; disposing the addon (or its terminal)
releases them. The host owns the PTY and installation of shell integration
scripts, which remain in the Rust terminal crate. This implements the existing
OSC 633 subset, not every shell protocol.

Run `pnpm --filter @orgii/terminal-shell-integration test`, `typecheck`, or
`build`. xterm is a peer dependency. The package exports TypeScript source for
frontend bundlers and is not published to npm.
