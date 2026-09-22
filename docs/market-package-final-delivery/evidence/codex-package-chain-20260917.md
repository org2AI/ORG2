# Codex Package chain — 2026-09-17 23:11–23:31Z

Instance 89 on this branch (stage `b9e8f0bd9b`, then `4b5ddba33` pending
build), local acceptance Market running Cloud PR #117 (`claude/codex-luna-
reserve-fallback`, gateway restarted on `75e69e6` at 23:29:04Z). No real money.

## 1. App connection: "Could not update this app connection"

- First Codex configure attempts (stages `0820dc670d`, `b9e8f0bd9b`) ended in
  the generic toast. `b9e8f0bd9` adds warn logging for the Market commands;
  the log then showed at 23:12:38Z:
  `[Market] configure_catalog failed agent=codex error=Cannot verify the installed harness version`.
- Cause: both stages were launched Finder-style (`env -i … open -a`, PATH
  `/usr/bin:/bin:/usr/sbin:/sbin`). The app's shell PATH probe
  (`app-paths/src/shell_path.rs`, `zsh -i -l -c 'echo $PATH'` then `zsh -l`)
  produced the login-only PATH, which lacks `/opt/homebrew/opt/node@22/bin`
  (added by `~/.zshrc`, keg-only Node). `/opt/homebrew/bin/codex` is the npm
  shim `#!/usr/bin/env node`, so `codex --version` fails with
  `env: node: No such file or directory` and the version probe returns no
  version. Claude Code (native binary) is unaffected, which is why every
  earlier acceptance passed. The same probe run by hand from a shell returns
  the full PATH in 0.6 s, so why it fails inside the app is still open.
- `4b5ddba33` appends the probe detail to the message
  ("…: Version command exited with 127: env: node: No such file or directory")
  in `harness_connections.rs` and `configure_catalog.rs`. Root fix (PATH probe
  under a Finder launch) is tracked as row 13.
- Relaunched at 23:14Z with `PATH=/opt/homebrew/opt/node@22/bin:…`: Configure
  → ORG2 Market → Codex diagnostics (gpt-5.6-luna, range 35–55 %) → Use this
  connection succeeded at 23:16Z. Written:
  `external-home/.codex/config.toml` (`model = "gpt-5.6-luna-org2-0c9fd82057897a798011"`,
  `model_provider = "orgii"`, `base_url = http://127.0.0.1:17976/cli/codex/<token>/v1`,
  `wire_api = "responses"`, `model_catalog_json` → `org2-model-catalog.json`, 62 KB)
  and `~/.orgii-instance89/cli-config-profiles/codex/{manifest.json,orgii/}`.
  Page shows "Codex diagnostics · ORG2 Market · Requires ORG2 to stay open".

## 2. Codex CLI 0.154.0 through the Package (clean env, `CODEX_HOME` = external home)

| time (Z) | request | upstream | buyer | notes |
|---|---|---|---|---|
| 23:17:24 | `pr_9cd461b8` | 429 `usage_limit_reached` (ordinary weekly 100 %, reserve 14 % used) | 503 `model_temporarily_unavailable` | provider circuit codex → DEGRADED `rate_limited`; **no reserve log**: the #117 fallback existed only on the workspace route `/w/`, Packages use `/p/` (`package-ingress.ts`) |
| 23:20:29 | `pr_0b3e46bb` | 429 | 503 | same; account cooldown 30 min (`package_account_load.cooldown_until` 23:50:29Z) |
| 23:29:19 | `pr_2ad1a7a5` | — | 503 | gateway on `75e69e6`; pool refused: account still in cooldown (no upstream call) |
| 23:30:35 | `pr_5caf4fad` | reserve attempt → **400** | 400 `upstream_request_failed` | cooldown cleared by hand (local state). Log: `route.refused capacity_degraded rate_limited` → `adapter.reserve_preempt source=circuit` → `adapter.reserve_unusable reserve_status=400` |

Direct probe of the CPA adapter (`http://127.0.0.1:33294/v1/responses`, adapter
key from the vault, model `gpt-reserve`):
`400 {"error":{"message":"unknown provider for model gpt-reserve","type":"invalid_request_error","code":"model_not_found","param":"model"}}`;
its `/v1/models` lists `gpt-5.6-sol/terra/luna` only. The adapter is the
unmodified upstream image `eceasy/cli-proxy-api@sha256:f077e153…`
(`DEFAULT_CPA_IMAGE`); CLIProxyAPI has no reserve routing — open request
[router-for-me/CLIProxyAPI#5568](https://github.com/router-for-me/CLIProxyAPI/issues/5568).
The raw upstream call with `model: gpt-reserve` through the CPA management
`api-call` path succeeded earlier today (`luna-reserve-mechanics.md`), so the
gap is only the adapter's model registry.

## 3. Cloud PR #117 changes made here

- `75e69e6` ports the fallback to the Package route: reactive retry once as
  `gpt-reserve` on a JSON `usage_limit_reached` 429 (never relayed), pre-empt
  from a live hint / telemetry / a `rate_limited` provider circuit
  (`shardDecision(reserve=true)`, router and pool), shared `ReserveHints`,
  meter `upstream_model`, `adapter.reserve_skipped` diagnostic on `/w/`.
  `test/unit/package-ingress-reserve.test.ts`, 8 cases; full unit suite 665
  pass / 0 fail; lint clean.
- `016055d`: a pre-empted reserve attempt the adapter cannot serve rejects the
  account (60 s) and moves on instead of relaying its 4xx (the 23:30:35 case
  becomes 503 `model_temporarily_unavailable`).
- Still needed for a working reserve hop: adapter support (fork the codex
  model registry to accept `gpt-reserve`, or a reserve hop via the CPA
  management `api-call` path, or upstream #5568). The ordinary Codex chain can
  be re-verified after the weekly reset (gmail account 2026-09-19 08:23Z,
  hotmail 09:22Z).

## 4. Not done

- Codex desktop app (`/Applications/ChatGPT.app` via the isolated launcher):
  not launched — needs a computer-use grant for that app, and with the
  ordinary window exhausted and no adapter reserve hop it could only show the
  same 503.
- Resend-fix re-verification (row 12) on the private build is still pending.

## 5. Official Codex app (ChatGPT.app) — 2026-09-17 23:55Z

Launched the prepared isolated wrapper (`launchers/Codex Package Acceptance.app`:
`CODEX_HOME` = the acceptance external home, `--user-data-dir=<acceptance>/codex-ui`).
It started as its own process (pid 74987) and left the user's own Codex
(pid 45009, its own data dir) untouched.

**The GUI could not be driven from here**: both processes share the bundle id
`com.openai.codex`, so the window tools resolve to whichever process the
window list returns — the user's. Driving it would have meant acting on the
user's live session, so the GUI instance was stopped again (`kill 74987`,
user's instance verified alive afterwards). A GUI pass needs either the
user at the keyboard or their instance closed.

**What was verified instead, headlessly**: the app's OWN engine —
`/Applications/ChatGPT.app/Contents/Resources/codex`, `codex-cli
0.154.0-alpha.6.2`, the binary the GUI drives through `codex app-server` —
run against the same `CODEX_HOME`:

```
model: gpt-5.6-luna-org2-0c9fd82057897a798011
provider: orgii
```

so the app's engine reads ORG2's generated `config.toml` and
`org2-model-catalog.json` and routes to `http://127.0.0.1:17976/cli/codex/<token>/v1`.
The call reached the Market gateway (`pr_2e7f56d8`), which logged
`route.refused capacity_degraded rate_limited` → `adapter.reserve_preempt
source=circuit` → `adapter.reserve_unusable reserve_status=400` and answered
`503 model_temporarily_unavailable`.

That 503 (rather than the adapter's raw 400 relayed as
`upstream_request_failed`) is commit `016055d` of Cloud PR #117 behaving as
designed, observed live.

So the client→proxy→gateway→adapter chain is proven for the official app's
engine as well as the CLI. What remains unproven is only the last hop: the
provider quota (ordinary window resets 2026-09-19 08:23Z / 09:22Z) and the
adapter's missing `gpt-reserve` support.

## 6. Why the adapter blocks the reserve, measured — 2026-09-18 00:24–00:26Z

Three experiments against the acceptance adapter
(`org2-cpa-cb_lWyBJ00TNVrOFIyw-s4`, the shard holding the gmail Codex
account). Its config was backed up inside the volume, changed, restarted,
and restored afterwards; it ends on its original 23-line config and answers
normally.

**(a) The `oauth-model-alias` config option does not help — refuted twice.**
The shipped `config.example.yaml` in the running image documents a per-channel
`oauth-model-alias` with a `codex:` section (`name` = upstream model id,
`alias` = client-visible id), which looked like a fork-free way in. Both
directions were tried and both fail:

| config | asked for | answer |
|---|---|---|
| `name: gpt-reserve`, `alias: gpt-reserve`, `fork: true` | `gpt-reserve` | `400 unknown provider for model gpt-reserve` |
| `name: gpt-reserve`, `alias: gpt-5.6-luna-reserve` | `gpt-5.6-luna-reserve` | `400 unknown provider for model gpt-5.6-luna-reserve` |

`/v1/models` was unchanged in both cases. An alias only renames a model the
registry already knows; it cannot introduce one.

**(b) The registry is remote, and its URL is not configurable.** The adapter
logs `startup model refresh completed from
https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json`
and repeats it every 3 h. Both that URL and the Codex client-models URL are
hard-coded constants in the binary; no config key or environment override
exists for either. So `gpt-reserve` becomes routable only when upstream adds
it to that file, or when the binary is replaced.

**(c) The reactive half of the Cloud #117 fallback cannot fire through an
adapter at all.** The adapter forwards none of the reserve headers — a 429
carries only CORS and `retry-after` — and once it has cooled the credential
it answers its own body rather than the provider's:

```
429 {"error":{"code":"model_cooldown","last_upstream_error":"usage_limit_reached: …",
     "message":"All credentials for model gpt-5.6-luna are cooling down via provider codex …",
     "model":"gpt-5.6-luna","provider":"codex","reset_seconds":115005}}
```

That body has `error.code`, not `error.type`, so `classifyCodex429` finds no
signal and the reactive retry correctly returns `none`. The reserve is
therefore reachable only by pre-emption — telemetry, a live hint, or the
`rate_limited` provider circuit added in `75e69e6`. Pinned by a test in
Cloud #117 (`f282a65`).

## 7. The remaining options, narrowed by measurement

| option | state |
|---|---|
| `oauth-model-alias` config | **refuted** (a) |
| point the model registry at our own list | **refuted** — URL is a compiled-in constant (b) |
| patch/fork CLIProxyAPI's registry, pin our own image | viable; cost is owning a fork of the component that holds sellers' OAuth credentials, and re-pinning five `DEFAULT_CPA_IMAGE` sites |
| reserve hop via the CPA **management** `api-call` path | **the only path proven to deliver a reserve answer today** — both the 21:33Z and the 00:21Z probes used it. Open: it is the adapter's admin credential on a buyer data path, and streaming is unverified |
| per-auth `model_aliases` inside the OAuth auth JSON | documented by the image, untested — it writes a seller credential file, so it was not tried unilaterally |
| wait for router-for-me/CLIProxyAPI#5568 | no maintainer response yet |
