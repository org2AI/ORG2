# TP Agent Studio — Cloud and protocol ownership boundary

**Status:** P0 release blocker, source audit only (2026-10-17). Not production-certified.
**PR:** https://github.com/TheerasakPing/ORG2/pull/9

## Verified from source

| Area | Current fork behavior | Release implication |
| --- | --- | --- |
| Desktop protocol | Tauri production: `tpagentstudio://`; Dev: `tpagentstudio-dev://`; numbered: `tpagentstudio-instanceN://` | Native registration and per-OS fresh-install collision tests outstanding |
| Frontend runtime profile | `src/config/runtimeInstance.ts` now maps fork bundle IDs to the same 23847/27888 ports and fork protocols as Rust / JS launcher | Source parity is not proof of E2E callback registration |
| OAuth callback target | `configureCloudAuthCallbackForIdentifier` derives the target from the runtime bundle ID | External Cloud web server must explicitly allow its own fork redirect and validate state |
| Default cloud service | `src/features/Org2Cloud/config.ts` still embeds ORG2-managed Supabase and web origin as fallback | **No fork-owned Cloud has been configured; do not use real accounts or distribute as independent Cloud** |
| Endpoint override | LocalStorage key `orgii:org2-cloud-v1:endpointOverride` | Browser storage and keychain ownership must be audited; malformed override falls back to upstream |
| Inbound invite/share | `org2CloudOrgManagement.ts` accepts `orgii://cloud/...` | Fork URLs are not handled by dedicated parsers |
| Session reference | `cloudSessionReference.ts` uses the `orgii:` reference scheme | Cross-instance / fork-specific provenance undefined |
| Billing | `billingComplete.ts` accepts `orgii://billing/complete` | Must not reuse original publisher billing confirmation flow |
| Memory | Workspace-local `.orgii` remains compatible with upstream data | Avoid opening same workspace simultaneously until data isolation/migration is implemented |

## Interim policy

1. Keep updater, inherited release jobs, production signing, and publishing **disabled**.
2. Treat Cloud onboarding, billing, remote sync, auth callbacks and implicit upstream credentials as **not production-ready** on this fork.
3. Do not enable upstream Cloud defaults or loosen scheme parsers as a quick fix. Changing URL scheme strings alone does not create owned authentication, tenants or billing infrastructure.
4. Do not migrate or copy persisted upstream access/refresh tokens or OS keychain entries automatically. Require user consent, explicit source/target and rollback plan.
5. Continue to validate local-only Agent Harness, session UI and tools independently of Cloud.

## Required implementation sequence

### A — Inventory and fork-owned backend

- [ ] Map all Cloud HTTP/WS clients, external login/payment pages, OS deep-link registrations, callback allowlists, app credentials and persisted sync cursors.
- [ ] Provision an explicitly fork-owned web origin and auth data plane, or an approved user-provided deployment, with isolated Supabase project, RLS, signing/key material and rotation process.
- [ ] Expose a release-safe Cloud **disabled/unconfigured** state instead of silently falling back to the upstream origin (including malformed or null overrides). Update UI so connection errors are actionable.
- [ ] Namespace Cloud browser keys/atoms, localStorage, OAuth state and secure OS credential storage per application + instance.
- [ ] Reject accidental imports from the upstream default unless a separately approved, scoped migration process authorizes them.

### B — Owned protocol and parser contracts

- [ ] Generate invite, share and billing callback links from an explicit, audited fork scheme and owned web origin.
- [ ] Normalize direct deep-link entry points for production, Dev and numbered instances; restrict auth and payment callbacks to exact expected scheme/host/path and state.
- [ ] Reject unexpected scheme, userinfo, duplicate critical parameters, fragments and malformed inputs. Never log or copy bearer tokens to generic navigation.
- [ ] Keep unsupported/unclaimed Cloud URLs fail-closed rather than converting to a generic React Router path.

### C — Cross-platform acceptance

- [ ] Unit-test explicit owned Cloud endpoint, missing config, malformed override, scheme matching, OAuth state, invite/share, billing, and data reset on switch.
- [ ] Test same-machine installs with original ORG2 on macOS Apple Silicon, Windows 11 and Linux: bundles, protocol handlers, ports, keychains, updater, workspace-local memory and credential files.
- [ ] Confirm genuine Cloud login and revocation against a **fork-owned staging tenant only** with redacted test artifacts.
- [ ] Record passing CI workflow URLs, installers/hashes, signed/notarized artifacts and a downgrade/rollback plan.

**Acceptance:** the fork cannot automatically read, write, authenticate against, bill through or update itself from the original publisher's Cloud services or profiles. Cloud use remains explicitly disabled until this contract is met.

Source findings are *not* operational proof; no Cloud tenancy, installer or credential-coexistence test is claimed here.
