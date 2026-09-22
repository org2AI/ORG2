# 7cc4 native Retry hydration regression

Measured private immutable build: `7cc48593a6211fd05d6ff7d779d917237fb6c869`.
Its debug binary was built, staged, signed and verified, then launched after a
normal Quit and backup of the preceding test instance. No installer was published.

The original failed C turn initially displayed an enabled Retry while history
and model selection loaded. Once the existing A/B/C native history loaded, the
same user message became an ordinary bubble and Retry disappeared. The attempted
stale accessibility click was rejected; no Retry was dispatched.

Read-only snapshots before and after hydration retained the same three intents,
one failed queue owner, one durable lineage and one native transcript. The ledger
remained 348 requests / 280 attempts / 743 postings. All request, attempt, posting,
load, package, version, access and protected historical records matched. All 44
protected primary configuration file checks remained unchanged.

## Root cause and correction

The real Rust ingestion boundary resolves the raw `user_message` function through
the `raw` action alias to canonical `functionName: user`. The preceding fixture
asserted the raw parser output and then manually supplied frontend fields, so it
missed this normalization. The held-owner projection only accepted
`functionName: user_message`, making the UI lose Retry after hydration.

The correction accepts these two native function names while retaining the
same-session, exact intent, user source, raw action, user-envelope, non-synthetic,
and absent explicit delivery-status checks. Explicitly sent rows and substantive
output retain their existing behavior. Native files and historical ledger rows
are not rewritten; no polling, automatic inference retry or new dispatch owner
is added.

The raw and preview reader contract test passed. Eight frontend suites / 113
tests passed, including startup fallback to hydrated A/B/C in the same store,
the actual group-header projection, rendered Retry callback and double-click
dispatch coverage. The normalized fixture fails all three cases on the old
production predicate. Fast typecheck and changed-file ESLint passed. The main
crate normalized-history contract test passed (1 test, full and preview paths).

Successful source tests alone do not establish a successful desktop Retry. The next immutable build still needs original-message Retry, context,
settlement and restart acceptance; official Codex Restore remains separate.
