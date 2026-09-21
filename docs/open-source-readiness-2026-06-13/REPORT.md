# Open-Source Readiness Audit — ORGII

**Date:** 2026-06-13
**Scope:** Read-only publishability audit of the working tree (tracked files) plus a bounded git-history spot-check.
**Repo:** `git@github.com:org2AI/ORG2.git` (1,213 commits)
**License:** AGPL-3.0-or-later

> This report does **not** modify source code. It flags what should not be published as-is and what is missing for a healthy OSS project. No git-history-rewriting commands were run.

---

## TL;DR

- **CRITICAL (blocking) findings: 0.** No live secrets, private keys, cloud credentials, or hardcoded tokens were found in the tracked tree. `.env` is gitignored, never committed, and locally empty. CI workflows correctly source all credentials from `${{ secrets.* }}`.
- The repo is in **good** OSS shape: LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, CLA, and issue/PR templates are all present, and `.gitignore` is comprehensive.
- The main pre-publish cleanups are **cosmetic/correctness**, not security: stale GitHub org/repo URLs (corrected to the current repository on 2026-09-15), a leftover `soyd` codename in `package.json`, and a developer's personal name/email in two spots.

---

## CRITICAL FINDINGS (block publication)

**None.**

No live API keys, OAuth client secrets, signing private keys, database credentials, JWTs, or cloud access keys were found in the current tracked tree. The `.env` file at the repo root is git-ignored (`.gitignore:57`), has **never** been committed (verified against all refs), and its local copy contains only empty keys. A bounded history scan (all refs for `.env`; most-recent 200 revisions for `AKIA*` / PEM private-key blocks) surfaced nothing.

---

## 1. Secrets & Credentials

| Sev  | File / Location                                                                 | Finding                                                                                                                              | Recommended action                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| none | `.env` (root)                                                                   | Git-ignored, never committed, locally empty.                                                                                         | No action.                                                                                                                                            |
| none | `.env.example`, `tests/e2e/.env.example`, `tests/blackboard-poc/.env.example`   | Templates with empty/placeholder values only (`your-azure-anthropic-key`, `https://your-resource.openai.azure.com`).                 | Keep as-is.                                                                                                                                           |
| none | `.github/workflows/release.yaml`, `ci.yml`                                      | All credentials referenced via `${{ secrets.* }}`; ephemeral keychain created and cleaned up. Good practice.                         | No action.                                                                                                                                            |
| low  | `src-tauri/crates/key-vault/**` (tests, snapshots, `key_extractor.rs`)          | Many `sk-ant-xxx`, `sk-test…`, `sk-proj-testkey…` strings. These are **test fixtures for the key-detection feature**, not real keys. | No action (optionally confirm `sk-b166e6c00f9246f4bda823196826815c` in snapshots is fabricated — it is referenced in source as an example proxy key). |
| none | `src-tauri/.../proxy/tests/server_tests.rs:336`, `terminal/src/redaction.rs:64` | `Bearer aoaAAAAAfaketoken` / `Bearer abcdef…` — obvious test fixtures.                                                               | No action.                                                                                                                                            |
| info | `src-tauri/tauri.conf.json:76`                                                  | `updater.pubkey` is a minisign **public** key (base64 `untrusted comment: minisign public key`). Public keys are meant to ship.      | No action.                                                                                                                                            |
| none | `.npmrc`                                                                        | No `_authToken` or registry credentials.                                                                                             | No action.                                                                                                                                            |

**No matches** for AWS `AKIA*`, Google `AIza*`, Slack `xox*`, GitHub PATs (`ghp_/gho_…`), Stripe live keys, or `BEGIN … PRIVATE KEY` blocks anywhere in tracked files. No connection strings with embedded real credentials (only `user:pass@…neon.tech` placeholders/examples).

---

## 2. Internal / Sensitive Info

| Sev    | File / Location                                                           | Finding                                                                                                                                                                                                                                                | Recommended action                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| medium | `src-tauri/tauri.macos.conf.json:10`; `.github/workflows/release.yaml:15` | Signing identity `Developer ID Application: HOUYi HE (S4UG24G7HJ)` exposes a developer's **personal full name** + Apple Team ID. (Note: this is also baked into every signed release binary, so it is already public to anyone who downloads a build.) | Decide whether the personal name is acceptable to publish. If the certificate is under a personal Apple Developer account, consider switching to an org-level Developer ID before the first public release; otherwise accept as known/public. |
| low    | `.github/workflows/release.yaml:32-34`                                    | Azure Trusted Signing infra identifiers in comments: account `orgii-codesign`, profile `orgii-windows`, endpoint `https://eus.codesigning.azure.net/`. These are resource names/endpoints, not secrets.                                                | Optional: trim to generic descriptions. No security risk.                                                                                                                                                                                     |
| low    | `src/hooks/project/useCurrentUserMemberId.ts:142`                         | Code comment uses a real-looking personal email as an example: `leeyyi@vip.qq.com`.                                                                                                                                                                    | Genericize to `user@example.com`.                                                                                                                                                                                                             |
| low    | `tests/e2e/.env.example`                                                  | Internal dev account name `vincetest1` ("canonical dev account") and internal relay model id `op-4.6-relay`.                                                                                                                                           | Optional: rename to a neutral placeholder before publishing.                                                                                                                                                                                  |
| none   | Slack / Linear / Jira references                                          | All are legitimate **public** integration API endpoints (`slack.com/api`, `api.linear.app/graphql`, `linear.app/oauth/...`) inside integration adapters. No internal/private infra.                                                                    | No action.                                                                                                                                                                                                                                    |
| none   | Hardcoded `localhost`/`127.0.0.1` endpoints in `src/` and `src-tauri/`    | Default ports for the app's own local sidecars/backend, with documented `process.env` overrides. Expected for a local-first desktop app.                                                                                                               | No action.                                                                                                                                                                                                                                    |

No internal hostnames, VPN/intranet/corp URLs, customer data, or proprietary third-party data found. (IP-address-looking strings in scans were invalid octets from minified/fixture content — false positives.)

---

## 3. Licensing & Legal

| Sev  | Item                                            | Finding                                                                                                                                                              | Recommended action                                                                                                       |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| none | `LICENSE`                                       | Present — GNU AGPL-3.0.                                                                                                                                              | No action.                                                                                                               |
| none | License consistency                             | `package.json` `"license": "AGPL-3.0-or-later"` and `src-tauri/Cargo.toml` `license = "AGPL-3.0-or-later"` both match the LICENSE file.                              | No action.                                                                                                               |
| none | Bundled font `src/assets/fonts/hack/LICENSE.md` | Hack (MIT) + DejaVu (public domain) + Bitstream Vera — all permissive and **compatible** with AGPL; attribution file present.                                        | No action.                                                                                                               |
| none | `docs/contributing/CLA.md`                      | Contributor License Agreement present.                                                                                                                               | No action.                                                                                                               |
| low  | Copyright / NOTICE                              | No project-level copyright holder line or `NOTICE` file; per-file AGPL headers are absent. Optional but recommended for AGPL projects to assert copyright ownership. | Consider adding a one-line copyright (e.g. `Copyright (C) 2026 YORG-AI`) and/or a short AGPL source header to key files. |

No GPL/AGPL-incompatible bundled third-party source was identified. AGPL is the strongest copyleft here, so permissive (MIT/BSD/Apache) dependencies pose no conflict.

---

## 4. Project Hygiene for OSS

| Sev    | Item                                                                                                 | Finding                                                                                                                                                                              | Recommended action                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| medium | `.github/ISSUE_TEMPLATE/config.yml`                                                                  | Historical finding: outdated repository links affected wiki, discussions, and security advisory links.                                                                               | Resolved: links now use `org2AI/ORG2`.                                                                       |
| medium | `src-tauri/crates/system-services/src/app_menu.rs`                                                   | Historical finding: the Report Issue menu used an outdated repository link.                                                                                                          | Resolved: opens `https://github.com/org2AI/ORG2/issues`.                                                     |
| low    | `src/modules/AppLogin/index.tsx`, `.archive/src/scaffold/NavigationSidebar/variants/HomeSidebar.tsx` | Historical finding: hardcoded GitHub links used an outdated repository identity.                                                                                                     | Resolved: links use `org2AI/ORG2`.                                                                           |
| low    | `package.json`                                                                                       | `"name": "com.soyd.app"` (legacy codename), `"description": ""` empty, `"author": ""` empty.                                                                                         | Set name/description/author to ORGII values before publishing to a registry.                                 |
| low    | Legacy codename                                                                                      | ~19 tracked files still reference `soyd`/`SOYD`. Most are internal (test configs, dev scripts, parser strings); a few are user/contributor-facing (the URLs above).                  | Sweep and decide whether to fully rename or keep internal references; prioritize the user-facing URLs above. |
| none   | README / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY.md                                                | All present and substantive. README has product description + Quick start; SECURITY.md has `security@orgii.ai` + coordinated-disclosure policy.                                      | No action.                                                                                                   |
| none   | Issue/PR templates                                                                                   | Full set present (`bug_report`, `feature_request`, `performance_report`, `agent_behavior`, `security_vulnerability`, `translation_issue`, `config.yml`, `PULL_REQUEST_TEMPLATE.md`). | No action (aside from the `config.yml` URL fix above).                                                       |
| none   | `.gitignore`                                                                                         | Comprehensive — ignores `.env`, build artifacts, model files, agent transcript dumps, sidecar binaries, IDE files. `build/` confirmed **not** tracked.                               | No action.                                                                                                   |

---

## 5. Debug / Dev Leftovers

| Sev  | Item                        | Finding                                                                                                                                                                | Recommended action                   |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| none | Secret logging              | No `console.log`/debug statements logging tokens, passwords, secrets, or credentials in `src/`. The terminal `redaction.rs` actively redacts `Authorization:` headers. | No action.                           |
| low  | `TODO`/`FIXME`/`XXX`/`HACK` | ~111 occurrences across `src/` and `src-tauri/`. Normal for a codebase this size; none observed to leak sensitive info.                                                | Not a blocker; optional triage pass. |
| none | Test fixtures               | E2E/unit fixtures use fabricated data (`orgii/app`, `postgres://user:pass@…`, `e2e@orgii.local`, `poc@test.local`). No real customer/user data.                        | No action.                           |
| none | Tracked binaries            | No tracked certs/keystores/`.p12`/`.pem`. Largest tracked files are lock files and source — no large binary blobs or model weights committed.                          | No action.                           |

---

## Prioritized "Must-Do Before Going Public" Checklist

**Blocking (security):**

- [ ] _(none — no live secrets found)_

**Strongly recommended (correctness / will break for users):**

- [x] Update issue-template repository links to `org2AI/ORG2`, including security advisories.
- [x] Update the in-app Report Issue URL to `https://github.com/org2AI/ORG2/issues`.
- [ ] Decide on the Apple signing identity exposing personal name `HOUYi HE` (`tauri.macos.conf.json:10`, `release.yaml:15`) — accept as already-public, or move to an org Developer ID.

**Recommended (polish / consistency):**

- [x] Normalize hardcoded GitHub URLs to `org2AI/ORG2` (`AppLogin/index.tsx`, archived `HomeSidebar.tsx`).
- [ ] Update `package.json` `name` (`com.soyd.app`), `description`, and `author`.
- [ ] Genericize the personal email in `useCurrentUserMemberId.ts:142` (`leeyyi@vip.qq.com` → `user@example.com`).
- [ ] Add a project copyright line / `NOTICE` for the AGPL license; consider AGPL source headers.
- [ ] Optional: sweep remaining `soyd`/`SOYD` codename references and rename `vincetest1` / trim Azure infra names in `release.yaml` comments.

**Verification before flipping public:**

- [ ] Run a full secret-history scan with a dedicated tool (e.g. `gitleaks detect`, `trufflehog git file://.`) over **all 1,213 commits** — this audit deep-scanned the current tree and spot-checked history; a full-history scan is the final gate. If anything turns up, scrub with `git filter-repo`/BFG **and rotate** before publishing.

---

### Method notes / coverage

- Secret scanning: `git grep` over tracked files for known key prefixes (`sk-`, `AKIA`, `AIza`, `xox*`, `ghp_`, Stripe live keys), credential assignments, connection strings, bearer tokens, and PEM private-key blocks; `pnpm-lock.yaml`/snapshots excluded from noise.
- History: `.env` checked against **all refs** (never committed); `AKIA*`/PEM blocks checked across the most-recent 200 of 1,213 revisions (not exhaustive — see verification checklist).
- Config reviewed: `tauri.conf.json`, `tauri.macos.conf.json`, `.github/workflows/*`, `.npmrc`, `.gitignore`, `package.json`, `Cargo.toml`.
