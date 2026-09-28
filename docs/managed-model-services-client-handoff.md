# Managed Model Services Client Handoff

2026-09-16. Implementation is awaiting acceptance. The user explicitly requested a blind implementation first, followed by consolidated testing, so this pass did not run automated tests, type checks, Rust compilation, desktop builds, Computer Use, or native-app verification. Formatting does not mean the code compiles or the functionality has passed.

## Client Flow Submitted

- Selected the native authorization, OS credential storage, dynamic authentication, session proxy, execution profile, configuration backup/conflict/recovery, and related historical-path dependencies from the fixed public #1846 head `d6643ab39059a7cc89f3381529c7562f57c65c63`. The old branch was not merged wholesale. Related tests and fixtures were retained with their call paths, but were not run in this pass.
- `src-tauri/crates/market-connect/src/services.rs` reads the catalog with `schema_version: 1`, confirms usage authorization, and obtains short-lived authentication scoped by access/model/session. Catalog pagination is 50 items per page, capped at 100 total; response bytes are bounded. Unknown protocols, invalid identifiers, and out-of-range responses are rejected.
- `workspace.rs` projects the managed catalog into the existing selector contract. The new `managed` field is optional, and the old workspace wire path remains parseable. Previously saved source references retain strict validation; missing authorization is not silently converted to a personal account.
- `source.rs` puts the authorized connection, stable access, selected model, and session identifier into a secret-free source reference. It passes through Tauri → normal session creation/continuation → persistence → reopen. The local proxy obtains a bearer token when needed; the renderer, IPC, and configuration files receive only the source reference or local proxy credential.
- First-time connection can start from the Console without an existing workspace authorization. The new flow uses an explicit initial-connection marker; existing workspace links continue to be validated against their existing fields. An old client launching a URL is not evidence that it supports the new catalog.
- The model selector uses the dynamic catalog. On first use of a Package, or when the server requires confirmation again, `UsageAuthorizationHost` displays every model in the package, public price ranges, and confirmation text stating that the wallet will be charged directly. One confirmation enables all models; switching models does not require enabling each separately. The server decides cases such as insufficient wallet balance and expired authorization; the client does not infer business rules.
- `AppConnectionPage` selects a service and model independently for each App. The logic that automatically reconfigured or restored other Apps when selecting a chat model was removed; a user's action for one App affects only that App.
- Native configuration continues to use existing hash-based conflict protection, backup, and recovery. Claude Code opens a terminal; Claude Desktop and Codex use their respective native launch entry points. ORG2 must be running to provide the local proxy for dynamic sources. Some launch entry points are platform-limited, so this does not establish cross-platform support.
- Market-specific MCP injection/routing was not migrated. Normal user MCP/Skill still uses the local execution path.
- The catalog cache lasts 30 seconds, is invalidated by connection changes, and coalesces concurrent reads; an expired request cannot overwrite a newer read. The native connection cache holds at most 32 owners, with up to 32 short-lived authentications per owner, evicted by expiration time. Ended sessions do not permanently consume source-selection slots. Active session routes have separate ownership and release paths.

## Public Protocol and Compatibility Scope

| Call | Client reads/submits |
| --- | --- |
| `GET /v1/market/packages` | Schema, service ID/name/version, model ID/protocol/compatible clients, public price ranges, model price ranges, wallet billing capability, public availability state, existing access, and service-level `requires_confirmation` |
| `POST /v1/market/package-access` | Service, expected version/revision, `billing_mode: wallet`, and explicit confirmation for the whole package; does not submit a model and returns a secret-free access reference |
| `POST /v1/market/package-access/:id/token` | Exact model and session; the native module validates the returned access, workspace, model, session, expiration, and gateway origin |
| Tauri `market_connection_activate_service` | Renderer initiates an explicit authorization action; the native layer reads the current authorized connection and proxies the public API |
| Tauri prepare/configure | Returns a bearer-free source reference for a single session or a single App configuration |

New sources retain the `market:` reference format and include strictly validated selection information; the new model/session fields are required only for new access references. Server catalog and short-lived authorization responses explicitly validate their versions. The public client does not embed a product list or server-side price-calculation policy.

Compatibility is determined by the server's declared capabilities. Initial acceptance covers text, client tools, and streaming requests through the existing Messages and Responses executors. Support for server-side history objects, multimodal features, other protocols, or native-app-specific requests must not be assumed.

## Acceptance Sequence for the Next Model

First record this branch's commit, the app bundle ID, the actual launched process, client version, and connected test environment. Build this branch; an old installation, screenshots from an old PR, or web-only results cannot substitute for this acceptance.

1. Run this repository's compilation and relevant tests, resolving type/platform differences; then use Computer Use against the actual build. Record commands, results, and failure reasons. This pass makes no claim that any new test passed.
2. With a brand-new user who has no existing service record, open the model selector/connection entry point, authorize, return, and load the real catalog. Check cancel/retry and empty/loading/expired/unknown-version states.
3. Select a service containing several models. Confirm that the UI shows all package price ranges and the direct-wallet-charge notice. After enabling once, switch to another compatible model without another per-model prompt. If the wallet balance is insufficient, visit the wallet, return to the original selection, and retry. A higher public price ceiling or a new model must require confirmation again; cancelling authorization must not start a request.
4. In ORG2, create a normal session; test a text round trip, multiple local-tool turns, stream cancellation, continuation, save, reopen, and full quit/relaunch. Check that the source and model persist and do not fall back to a personal account; switching to a new session must not rewrite an old one.
5. Configure Claude Code, Claude Desktop, and Codex separately: choose a service, choose a model, launch, make a real call, close, and reopen. Record each target separately; do not extrapolate one success to another target or platform.
6. Changing service/model for App A must not change App B. Switching between a managed model and personal account in ORG2 Chat must not change a connected App. Disconnecting restores only the selected App. After an external configuration edit, connect/recovery must report the conflict accurately and preserve the external change.
7. Distinguish closing a window from fully quitting. Verify proxy/lock/execution-profile lifecycles and that dynamic authentication is rebuilt after restart. Then test multi-instance exclusion and an in-flight request when authorization is revoked.
8. Create and end more than 32 sessions in succession. Check token-cache eviction, route release, and history recovery. Repeatedly open/close the selector and observe concurrent reads, idle network traffic, CPU/RAM, and subscription counts.
9. Run regressions for personal Key Vault, normal local MCP/Skill, and historical import paths. Old sources must remain parseable, but recovery/configuration of old managed sources against the new catalog still needs hands-on confirmation.
10. Check light/dark themes, Chinese/English, narrow windows, and loading/empty/error/unavailable states; save screenshots. Verify that upstream credentials and long-lived authorization do not appear in the browser/renderer, IPC, logs, or configuration files.

## Architecture Handoff Record

| Layer | Source work in this pass and remaining evidence |
| --- | --- |
| 1. Compile correctness | Compilation/type checks were not run as requested; next pass must run them. |
| 2. Dependencies/duplicate paths | Traced authorization → source → session/proxy → native configuration; removed Market MCP and cross-App auto-sync, which this feature does not need. |
| 3. Naming | UI uses the official Package/managed-service terminology; compatible wire names such as `WorkspaceEntitlement` remain, while new managed data is represented separately. |
| 4. Semantics | Secret-free source references and authentication are separate; usage authorization and native configuration are distinct actions. |
| 5. Default branches | Unknown protocols, missing authorization, and unsupported models are rejected; they do not fall back to a personal account. |
| 6. Responsibilities | Generic dynamic credentials/session routing do not contain server-side business policy. |
| 7. Readability | This document lists public calls, migrated dependencies, and execution paths so the changes can be understood without session context. |
| 8. Wire | Rust/TypeScript catalog and access structures were added together; serialization and unknown-version behavior still need hands-on verification. |
| 9. Initialization | Credential source is passed through creation/run/continuation and test entry points; each entry point still needs hands-on verification. |
| 10. Recovery | Session persistence, history projection, and execution-profile recovery all pass the source through; process-restart evidence remains to be collected. |

Dependency and lockfile changes are needed to include the native connection module. Before rolling back the client, disconnect/restore the external App configurations it manages, and preserve configuration backups and user history. Do not simulate a successful rollback by deleting OS credentials or history. No deployment, user-configuration rewrite, or real connection was performed.

## Whole-Package Authorization Correction and Open Tests

This change moves authorization state to the service-level `requires_confirmation` field, consumed consistently by Rust/TypeScript and the entry points; the enable IPC/API no longer includes a model. Models remain part of session routing and each App's actual call configuration. A temporarily unavailable model or one incompatible with the target App does not become a separate purchase item.

The confirmation dialog displays every model in the package and confirms direct wallet billing; users cannot select a subset of models. A server request for renewed confirmation still applies to the whole package. The new managed catalog must provide the service-level field. If it is missing, parsing is rejected rather than guessing authorization state, and release must be coordinated with the public service contract. Legacy non-managed source parsing is unchanged.

Added `src/features/MarketConnect/usageAuthorization.test.ts` to cover switching models after one confirmation, cancelling whole-package confirmation, and a model being temporarily unavailable. Later, run `pnpm test -- src/features/MarketConnect/usageAuthorization.test.ts` and perform real UI/native regressions. This pass did not run tests, type checks, builds, or Computer Use; earlier acceptance does not replace this verification. Review fixes for App connections were included in a later commit: the model Select adapts its shared callback type to a string, the test preserves Jotai's original export, and explicitly checks that selecting a service leaves it unconfigured until Connect is clicked, at which point the selected model is passed. Package authorization still covers every model; this model is only for calls from the target App. This pass included source review and diff checks only; the test and build were not run.

## Displaying Public Price Ranges

The catalog adds optional `price_range_bps: { min, max }`; models add optional `pricing_range: { min, max }`. The confirmation dialog displays public ranges and per-model ranges, not a single fixed usage rate. Rust and TypeScript parse the fields in sync; older catalogs remain readable, but new authorization is blocked when public ranges are missing, with a prompt to refresh.

Authorization covers every model in the package and charges the wallet directly. Prices may vary within the range; a higher public price ceiling or an added model requires confirmation again. The compatible `pricing` field represents the upper bound of the published range. The new UI does not present it as a fixed transaction price. This repository only consumes public fields; it adds no server-side price calculation or operations configuration.

This pass included source inspection and formatting only; tests, type checks, builds, and GUI acceptance were not run. Follow-up verification must cover range display, whole-package authorization without a model, no repeated confirmation for in-range changes, confirmation when the ceiling rises, and the prompt shown when an older catalog has no range.

## Direct Wallet Billing and Direct Launch

New enable requests use `billing_mode: wallet` and no longer send a package budget. Rust access `budget_usd6` is now nullable: wallet mode requires it to be null, while the historical limited-budget mode still accepts a positive integer. Catalog reads explicitly declare `wallet_billing=1` and derive `wallet_billing_supported` from `billing_modes`. If an older server does not declare this capability, the UI blocks new enablement and says the service needs an update; it does not assume support.

An enabled wallet access that needs no renewed confirmation can be used directly. Historical limited-budget access requires one explicit confirmation to switch to wallet billing. All models in the package share the same access; multiple packages share the wallet, and later top-ups do not require changing package budgets. The confirmation button itself authorizes billing; there is no budget input or extra checkbox.

After the market completes package multi-selection, it launches ORG2 directly. The deep link carries the real access workspace, allowing an existing connection to be reused after live catalog validation. If the user has not yet authorized, the existing PKCE login flow remains. The actual build from this branch must be used to verify browser launch, connection reuse, the first call after enabling, and use across models/packages. These checks were not run in this pass, and no local native configuration was changed.

On rollback, preserve user data and App configuration backups. Old clients cannot parse wallet access with a null budget, so isolation at the server capability boundary is required; results from the new web/API client are not evidence of compatibility with older desktop versions.
