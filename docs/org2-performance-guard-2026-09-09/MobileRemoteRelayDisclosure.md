# Relay configuration disclosure and retry

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | Retry calls existing notifyCloudAuthChanged, whose Rust handler advances the existing supervisor watch generation | No new polling, listener, timer or supervisor; clicks single-flight until command settles | Component test covers pending duplicate clicks, rejection and retry; desktop network reconnect not run |
| Memory | keep | Two disclosure booleans plus one reconnect boolean/ref owned by component | Constant space; remount resets disclosure; no retained collection | Remount regression test |
| Scope/isolation | keep | Existing useAsyncData keys include connection settings and cloud identity, and reject older query generations | Disclosure does not alter keys or write settings; explicit enable initializes only empty address | Custom-address preservation and empty-address enable tests; existing keyed hook reviewed |
| Rendering/hot path | keep | Disclosure changes only local UI; requests still belong to existing section | No additional subscription or streaming work | Component tests and scoped lint |

Lifecycle: closed advanced settings mount no inputs; expanded settings use existing persisted setters; collapse/remount never resets addresses. Enabling mobile remote or relay writes the production address only if the address is empty. Existing empty configurations can be repaired with Restore default address. Retry remains bounded to a user click, disables during its command, and refreshes status afterward. Failure reports an error and unlocks the action. Status refresh retains existing keyed-query lifecycle protection. No backend, persistence format, or wire changes were made.

Verification:
- `pnpm test src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.relayPreset.test.ts src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.pairing.test.ts`
- Scoped ESLint passed for the component and relay preset tests
- `git diff --check` passed
- Post-rebase `node node_modules/typescript/bin/tsc --noEmit --pretty false` on the stacked activation tip passed, covering the changed settings files

Performance verdict: blocked — no desktop runtime CPU/RSS or real reconnect measurements performed. Static inspection and component regression coverage show no new continuous work; no runtime performance improvement is claimed.
