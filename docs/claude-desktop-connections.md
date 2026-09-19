# Claude Desktop connections

For saved providers, custom model IDs, and role mappings, see [Claude provider profiles](claude-provider-profiles.md).

Open **Settings → App connections → Claude Desktop**. Claude Code CLI and Codex have separate selectors and independent applied connections. The existing `app/harness-connections` settings URL is unchanged.

Desktop is configured only through saved provider profiles. Create a profile, or
choose **Copy current connection** to start from the connection currently applied
to Desktop (it does not read the CLI's connection). Select the profile's Key Vault
credential, endpoint, and authentication scheme, then configure the model roles.
Save the profile, test its models, and apply it. Fully quit and reopen Claude
Desktop after applying or restoring. Endpoint and mapping changes belong to this
app's profile and do not edit the shared credential or CLI configuration.

## Compatibility

Saved profiles support custom model IDs through native Desktop family-tier
mapping. There is no single-model quick editor for Desktop; that editor remains
for Claude Code CLI and Codex only. Model availability depends on the endpoint.

The native adapter targets Claude Desktop 1.46388.1 and newer within the 1.x line on macOS and Windows; a different major version is reported as an unverified configuration format instead of being written. Pre-release suffixes such as `1.46388.1-beta` are compared by their numeric segments. The local macOS installation inspected during development was 1.46388.4. Version detection supports `/Applications/Claude.app`, user Applications installs, and on Windows `%LOCALAPPDATA%\AnthropicClaude\claude.exe` (Squirrel layout) with `%LOCALAPPDATA%\Claude\Claude.exe` as a fallback. The Windows paths follow Anthropic's documentation but have not been exercised on a Windows machine. Linux is explicitly unsupported by this adapter, even though newer upstream Desktop versions document Linux configuration.

Native Desktop UI/runtime behavior, including separate Chat/Cowork/Code sessions, has not been exercised. A protocol test or generated profile does not establish native-app runtime compatibility. This change neither launches nor restarts Desktop automatically.

Protocol translation and the broader Codex/ORGII model catalog expansion remain separate work. Desktop profiles use native direct routing, without an ORGII proxy.

## Configuration ownership and recovery

The adapter writes four user-owned files: normal Desktop configuration, 3P Desktop configuration, the profile catalog, and a distinct ORGII profile. On macOS these live under `~/Library/Application Support/Claude` and `Claude-3p`. On Windows the normal Desktop configuration is the roaming `%APPDATA%\Claude\claude_desktop_config.json` (Electron `userData`), while the 3P configuration, catalog, and profile live under the local `%LOCALAPPDATA%\Claude-3p`. An isolated `ORGII_EXTERNAL_HISTORY_HOME` redirects all these paths.

Only the deployment-mode selector is changed in each app config. Other fields and catalog entries are preserved. ORGII does not change network-egress permissions or suppress the native mode chooser. Existing inline enterprise configuration and detected managed preferences/policy block local switching. This check is conservative: even an app-behavior-only managed policy is currently reported as externally controlled.

All four files participate in the existing locked, journaled config transaction. The adapter refuses stale previews, existing unowned profile-ID collisions, malformed configuration, and conflicting external edits. **Restore original setup** restores the exact pre-switch files, including the previous mode/profile selection, and removes files that were originally absent. It does not necessarily select official login if the prior setup was already third-party. Native account credentials are not changed.

Direct configuration continues to work after ORGII exits. A vault key deletion or rotation does not revoke/rewrite credentials already exported to Desktop: test and reapply the updated key, or restore the original configuration. Restore Desktop before downgrading ORGII to a release that lacks this adapter. There is no database migration; the existing manifest format and CLI target identities are preserved.

The Windows-only `winreg` dependency reads policy without launching a subprocess; its version was already in the lockfile. Windows installation version lookup uses a bounded, cancellable PowerShell read of executable metadata with its console window suppressed, and never runs Claude.

## Everyday Code sessions in gateway mode

Claude Desktop keeps one Code-tab catalog per deployment mode:
`Claude/claude-code-sessions` for the signed-in app and
`Claude-3p/claude-code-sessions` for third-party (gateway) mode. Both catalogs
hold only small discovery rows; the conversations themselves are the Claude
Code transcripts under `~/.claude/projects`, which both modes share. A session
is therefore missing from the gateway-mode Code tab only because no row names
it there.

ORGII closes that gap in two places:

- Sessions run from ORGII are published to every Desktop catalog that already
  exists, not only the signed-in one. Gateway publication only inserts missing
  rows, preserving every existing row byte for byte, including rows ORGII
  previously created and Desktop may have edited. A failure in the gateway
  catalog is logged and never holds back the signed-in catalog. The existing
  signed-in publication and refresh behavior is unchanged.
- On startup, one bounded pass lists the signed-in profile's Code sessions in
  the gateway catalog: the active account's rows whose transcript still exists
  and that the gateway profile does not list yet (at most 512 per pass).
  Discovery scans have entry budgets and reject non-regular JSON files or
  metadata over 256 KiB. Transcript bodies are not read by the backfill.

The gateway profile has no Anthropic account. Its rows live under the local id
in `Claude-3p/config.json` (`lastKnownAccountUuid`) and the project Desktop
registered for that profile, recorded beside it as
`<org>.profile-origin.json` with `mode: "local"`. ORGII reads both and never
invents either; a profile that was never opened is not created.

What is and is not carried over:

- Only discovery fields are inherited (ids, folder, times, title, model,
  archived flag, turn count). Permission mode, always-allowed reasons,
  computer-use and browser grants, bypass choices and remote MCP servers are
  not: an inherited session starts from Desktop's defaults in gateway mode.
- The startup backfill only reads the signed-in catalog. Gateway discovery
  never replaces existing rows, even when Desktop writes concurrently;
  publication uses an atomic create-if-absent operation. Existing ORGII
  session refreshes in the signed-in catalog retain their prior behavior.
  Every row ORGII adds carries `orgiiMaterialization: true`, and only such
  rows are ever removed by ORGII.
- Chat conversations live with the Anthropic account and Cowork sessions keep
  their transcripts inside each profile, so neither can be listed across
  modes.

Continuing an inherited session in gateway mode sends its next turns through
the configured gateway and is billed there; a model the gateway does not offer
fails at that point. **Restore original setup** does not touch either catalog:
rows already listed in the gateway profile stay there and are simply not read
while Desktop runs signed in. On first use, open gateway mode once so Desktop
registers its profile, then restart ORGII to run the startup backfill. Fully
quit and reopen Desktop for the acceptance check; whether it discovers new
rows without restarting still requires a real Desktop test.

## References

The separate configuration boundary follows [Anthropic's Desktop gateway documentation](https://code.claude.com/docs/en/llm-gateway-connect#desktop-app). Local profile storage, auth schemes, and model fields follow the [Desktop configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration). The UI workflow was informed by [cc-switch's Desktop guide](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.6-claude-desktop.md); no upstream implementation was copied.

## Isolated Market App history

Market's **Open app** action also imports missing Code conversations into that
Cloud/user's isolated Claude profile. This is a snapshot import: it copies the
main transcript before inserting the discovery row, never replaces either
existing file, and never copies credentials, settings, or remembered grants.
The first resumed turn uses the package profile's default model rather than an
old provider model. New turns stay in the isolated profile; they are not merged
back into the main App, nor do later main-App turns overwrite an imported copy.
Chat, Cowork, subagent sidecar transcripts and external attachments are not
imported by this path. Restore preserves imported conversations.

Import runs only on the explicit Open app action, inside the existing owner and
configuration barriers. Desktop must register its own account/project identity;
first launch waits at most five seconds for that registration, without retaining
a watcher. If registration or UI discovery is late, quit Claude and use Open app
again. No profile IDs or directories are linked or fabricated.

Each pass retains the bounded catalog scan and 512-row insertion cap. Main
transcripts are limited to 128 MiB each and 1536 MiB total per action, streamed in
64 KiB chunks with a 15-second copy budget. In-progress partial JSONL records
and files changed during copying are skipped for a later action. Existing
content survives a retry or a crash before catalog publication. Files beyond
these bounds are not promised to appear; native runtime acceptance is separate
from the importer regression tests.

Opening a saved Market client after restarting ORG2 waits for the local managed
proxy to become ready before dispatching the client. A saved configuration alone
does not establish that its loopback listener is running.
