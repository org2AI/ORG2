# Running development beside the bundled app

Run `pnpm run tauri:dev` as usual. The dev launcher applies
`src-tauri/tauri.dev.conf.json` so the single-instance plugin treats development
and the installed app as separate applications. The light, Rspack, webpack,
and `tauri:dev:only` entry points use the same dev identity.

| Resource                      | Bundled app                | Development               |
| ----------------------------- | -------------------------- | ------------------------- |
| App identifier                | `org2ai.org2`              | `org2ai.org2.dev`         |
| Product name                  | ORG2                       | ORG2 Dev                  |
| IDE HTTP/WebSocket port       | 13847                      | 13946                     |
| Managed CLI proxy port        | 17888                      | 17987                     |
| Local database/settings root  | `~/.orgii`                 | Same `~/.orgii`           |
| Default external history root | User home                  | Same user home            |
| Deep-link schemes             | `yorgai`, `orgii`          | `yorgai-dev`, `orgii-dev` |
| Login store                   | Primary app-data directory | Same primary login store  |

Dev reserves service slot 100, outside the numbered instance range 2–99.
Rust derives its shared data-root policy and separate ports from the embedded identifier, including
when the compiled binary is launched directly. Explicit environment overrides
remain available for test/portable setups.

## Shared login

Development reads and writes the bundled app's existing
`shared-service-auth.json`. On macOS that file lives in
`~/Library/Application Support/org2ai.org2/`. The file contains only the existing
auth storage keys; other WebView storage remains separate. Numbered test
instances continue to use their own auth stores and local data homes.

Startup and focus return reload the shared state. Signing out is shared too:
the other app picks up the change when it synchronizes. The existing serialized
write queue and focus synchronization remain in use; this change adds no polling.
Simultaneous refresh/write races across separate processes are not covered by the
per-process queue and have not been stress-tested.

## Shared session database

Development and the bundled app both open the existing `~/.orgii/sessions.db`.
The shared root also keeps session images, tool results, file history, and shell
replays accessible from either app; settings and project data under that root
are shared too. Provider history sources remain the same. Nothing is copied or
merged. Explicit `ORGII_HOME` overrides still select a different data root.

The existing database layer uses SQLite WAL, immediate write transactions, and a
15-second busy timeout. A regression test writes real session events from two
processes into a temporary shared database and reads them back through both
identities. This verifies persistence, not live UI synchronization or concurrent
execution of the same session: runtime ownership and frontend notifications
remain process-local. Full simultaneous active-session and background-worker
behavior has not been stress-tested. Use compatible dev/bundled schema versions;
future dev schema changes would affect this shared database.

## Compatibility and recovery

The installed app keeps its identifier, data, and auth file. Dev now reuses the
existing sessions and login with a separate app identity. Any earlier `.orgii-dev`
data is left untouched and is not automatically merged. No historical data is
deleted or migrated by this change. Production build commands
do not apply the dev config. Development disables the updater in its config.

To undo the separation, revert the dev config and launcher/runtime mapping
changes. The primary data and auth file remain in their existing locations.
Do not delete the shared auth file to reset dev state: that also signs out the
bundled app.

## Startup theme guard

The HTML now loads the light base stylesheet before startup JavaScript runs.
Theme initialization uses the same bounded loader as later appearance changes:
it retains the base until the selected stylesheet loads. A failed or timed-out
system-dark load therefore leaves a styled light app, while preserving the
"Follow device" preference for later synchronization. The paint wait also has
a timeout, so paused animation frames in a hidden macOS window cannot strand
theme initialization.

## Dev icon

The dev identity uses an amber `<II>` icon in the Dock/app switcher and window
icons. Its Tauri config supplies the icon before startup, and the native icon
setter preserves it when the shared `general.dockIcon` preference is reapplied.
The preference itself remains unchanged and still controls the installed app.
Restart the dev process after rebuilding to see the new native icon.

The editable source is `src/assets/appIcons/dev.svg`; regenerate the desktop
PNG, ICNS, and ICO assets with `node scripts/tauri/dev-icons.mjs`.

## macOS Dock name in development

`tauri dev` launches Cargo's bare `org2` executable. The `productName` setting
names a packaged `.app`, so it does not change that executable's Dock tooltip.
Before native startup, the dedicated dev identity creates a sibling hard link
named `ORG2 Dev` and uses `exec` to enter it. The executable stays beside its
sidecars/resources; PID, arguments, environment, working directory, and inherited
stdio are preserved. The filename check prevents a second exec.

The alias is refreshed atomically on each original-binary launch so it follows
rebuilds without copying the binary. Bundled apps and numbered test identities
skip this step. If the build directory cannot create the link, startup continues
with a diagnostic and the original filename. Restart development to apply the
new name; the running process cannot acquire it from frontend hot reload alone.
