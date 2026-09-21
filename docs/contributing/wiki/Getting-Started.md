# Getting Started

This page covers everything needed to install ORGII, get it running, and launch your first agent session.

## Option A — Download the desktop app

The easiest way to start is to download a pre-built release.

1. Go to the [Releases](https://github.com/org2AI/ORG2/releases) page.
2. Download the asset for your platform:
   - **macOS (Apple Silicon):** `ORGII_<version>_aarch64.dmg`
   - **macOS (Intel):** `ORGII_<version>_x64.dmg`
   - **Windows:** `ORGII_<version>_x64-setup.exe`
   - **Linux:** `ORGII_<version>_amd64.AppImage` (or `.deb`)
3. Open the installer and follow the on-screen instructions.
4. Launch ORGII. On first run, the setup walkthrough will guide you through connecting your first provider.

## Option B — Build from source

### Prerequisites

| Tool                | Minimum version                     | Notes                                                                                                     |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node.js             | 20 (current LTS)                    | `node --version` to check                                                                                 |
| pnpm                | 9+                                  | `npm install -g pnpm` if missing                                                                          |
| Rust toolchain      | See `src-tauri/rust-toolchain.toml` | Install via [rustup](https://rustup.rs)                                                                   |
| Tauri prerequisites | v2                                  | Platform-specific system libraries — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |
| Python 3            | 3.8+                                | Only needed for the optional sidecar download scripts                                                     |

> **macOS note:** Xcode Command Line Tools and `cmake` (via Homebrew) are required for the Rust build.

### Clone and install

```bash
git clone https://github.com/org2AI/ORG2.git
cd ORG2
pnpm install
```

### Download optional sidecars

Browser Use and Computer Use features rely on native helpers (`agent-browser` and `peekaboo` on macOS). Download them with:

```bash
pnpm run download:sidecars
```

If sidecars are missing, the build still succeeds and the related features fall back gracefully or remain unavailable.

### Run in development mode

```bash
pnpm run tauri:dev
```

This command starts the Tauri shell and the webpack dev server together. The app opens automatically.

For faster UI-only iteration (no Tauri shell):

```bash
pnpm run start:fast
```

### Build for local testing

To produce a packaged app bundle quickly without a full release build:

```bash
pnpm run tauri:build:fast:open
```

This cleans only the app target for the local development profile, rebuilds, and opens the result.

---

## First run: connecting a provider

After launching ORGII, the setup walkthrough opens automatically. You can also reach it later via **Settings → Key Vault**.

Choose how you want to power your agent sessions:

Enter your API key or subscription credentials in Key Vault. ORGII stores keys locally in an encrypted key vault — they are never sent to ORGII servers.

---

## Launching your first session

1. Click the **+** button in the session list or press the session creator shortcut.
2. Select a **session type**:
   - **CLI Agent** — wraps an external coding agent process (Cursor, Claude Code, Codex, etc.)
   - **Rust Agent** — uses ORGII's built-in SDE Agent or OS Agent
3. Pick the provider/model from the selector.
4. Enter your task description and press **Send**.

The agent starts running. You can watch its progress in the WorkStation, which surfaces the code it edits, the terminal commands it runs, and its reasoning.

---

## Useful scripts reference

| Script                                | Purpose                                          |
| ------------------------------------- | ------------------------------------------------ |
| `pnpm run tauri:dev`                  | Full dev mode — Tauri shell + webpack dev server |
| `pnpm run start:fast`                 | Frontend dev server only (fast UI iteration)     |
| `pnpm run tauri:build:fast:open`      | Fast packaged build, opens immediately           |
| `pnpm run download:sidecars`          | Download Browser Use / Computer Use helpers      |
| `pnpm run lint` / `pnpm run lint:fix` | Check / auto-fix frontend lint                   |
| `pnpm run test`                       | Run frontend tests                               |
| `pnpm run cargo:check`                | Validate Rust without building                   |
| `pnpm run cargo:clippy`               | Rust lint checks                                 |
| `pnpm run cargo:test`                 | Rust tests                                       |

---

## Next steps

- [Sessions](Sessions) — understand how agent sessions work, session types, and execution modes.
- [WorkStation](WorkStation) — explore the editor, terminal, diff viewer, and panels.
- [Key Vault](Key-Vault) — manage API keys and provider accounts.
- [Contributing](Contributing) — set up for development and submit your first PR.
