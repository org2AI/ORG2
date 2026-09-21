# Mobile change review refresh lifecycle

## Contract and source

`session/changes` is the authoritative read-only RPC. Its validated manifest and per-file snapshot are owned by `useChangeReview`; FileReview owns expansion, wrapping and version-side interaction state. Tool/transcript revision events request fresh data for the same resource. The old hook included revision in resource identity, and both parent render gates replaced successful readers with loading/error UI. This unmounted children and lost interaction state. There is no persisted pollution or historical remediation.

The resource identity is client object + session + round + scope + optional path. Request revision and retry attempt determine completion, independently of resource identity. A request's abort controller rejects superseded completions. Retention is one validated result per enabled hook, replacing the previous result rather than accumulating generations. Disabled, hidden/offline, collapsed/offscreen, client/account, scope and session/round/path transitions clear it. The footer owns the turn manifest; the panel reuses that result rather than issuing a duplicate.

## State and transition policy

| Event/state                            | Data/UI                                                                  | Work and recovery                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| First open                             | Loading without old content                                              | Debounced request                                                                                                                        |
| Success/partial/empty                  | Validated result; existing partial/empty behavior                        | No polling                                                                                                                               |
| Same-resource revision                 | Prior successful data and live reader remain mounted; refreshing notice  | Abort old generation, coalesce 250ms bursts                                                                                              |
| First failure                          | Error with retry                                                         | No automatic loop                                                                                                                        |
| Refresh failure                        | Prior version remains readable, with explicit last-loaded-version notice | Retry clears failure state but retains reader; repeated taps deduplicated                                                                |
| Refresh success                        | Replace data in current reader                                           | Same-path expansion/wrap/disclosure survives; removed paths unmount; an empty turn footer does not reset an already-open different scope |
| Client/session/round/scope/path change | Immediately clear old content                                            | Abort old generation and load new resource                                                                                               |
| Offline/hidden/collapse/offscreen      | Clear snapshot and unmount heavy content                                 | Cancel timer and abort request; return re-fetches on demand                                                                              |
| Panel close/unmount                    | Dispose panel resources                                                  | Footer retains only its own enabled manifest                                                                                             |

The editor may intentionally rebuild when its underlying original document changes (existing CodeMirror merge-view requirement), or when the user switches full/diff mode or file. This fix promises continuity for ordinary same-resource refresh, not persistence of editor state across eviction or a different document.

## Ten architecture layers

1. Compilation: full `pnpm exec tsgo --noEmit --pretty false` passed.
2. Ownership/de-duplication: one turn-manifest owner, one enabled result per file; no global cache introduced.
3. Naming: resource key and request revision remain separate fields.
4. Semantic overloading: revision no longer masquerades as resource identity.
5. Defaults: no-result error and retained-result error are explicit; empty success clears previous files.
6. Boundaries: UI remains read-only and uses MobileRpcClient; no desktop services added.
7. Clarity: `refreshing` describes pending-with-data; `error` describes latest-attempt failure.
8. Wire: unchanged method, parameters, validation limits and cancellation signal; no serialization/schema change.
9. Init parity: footer, scoped manifest and detail all use the same hook and cancellation policy.
10. Resolver symmetry: both value and failure retention require identical client and resource key; request completion also checks revision and attempt.

## Performance guard

| Area               | Verdict | Evidence                                                                                                    | Change or reason kept                                                                                                                   | Verification                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Background work    | keep    | One 250ms debounce and one AbortController per enabled hook                                                 | No polling; cleanup on dependency change/unmount                                                                                        | Request-count, burst, hidden/disabled and abort tests                          |
| Memory             | fix     | One validated result per active hook, maximum 500 manifest rows and 3MiB per validated response             | Do not accumulate revision generations; eviction still releases heavy snapshots/editors; offscreen sections retain only measured height | Disabled/switch tests and mounted offscreen-content absence assertion          |
| Scope/isolation    | fix     | Client/session/round/scope/path define resource; revision/attempt define completion                         | Synchronous result exclusion on identity switch; late aborted completions cannot commit                                                 | Hook and mounted parent switch/stale tests                                     |
| Rendering/hot path | fix     | Parent pending/error gates previously unmounted readers; eviction previously removed measured scroll height | Keep same-resource reader through refresh; IntersectionObserver + ResizeObserver preserve shell height while evicting heavy content     | Node identity, wrap, disclosure, scrollTop and measured-placeholder assertions |

Every FileReview owns its observers; both disconnect on element change/unmount and callbacks are guarded after disposal. Resize measurement updates a local number, not React state on every resize. Intersection transitions publish visibility/retained height. The manifest's existing 500-file validation bound also bounds lightweight shells/observers. No claim of measured CPU/RSS improvement is made.

Performance verdict: **blocked** for native WebKit CPU/RSS and physical-device scrolling measurements. Automated lifecycle invariants pass; Chromium browser verification passed at 390 × 844 with real CodeMirror: DOM identity and scrollTop 340 survived pending/error/retry in both themes. Offscreen patch rows were removed while section height remained exactly 1877.25px. No page errors occurred. Screenshots are linked in the companion UI audit.

## Verification

- `pnpm test src/modules/MobileRemote/components/changes`: 6 files, 75 tests passed
- `pnpm exec tsgo --noEmit --pretty false`: passed
- Scoped ESLint with `--max-warnings 0`: passed
- Native iOS/WebKit and real relay-account switching not exercised; the unit tests use faithful deferred RPCs and the mounted parent with an editor stand-in

The empty-turn parent regression was also run with the previous early-return gate restored: it failed because the selected workspace scope reset to turn. Restoring the stable render slot passes the test.
