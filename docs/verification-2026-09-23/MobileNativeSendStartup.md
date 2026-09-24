# Mobile native session send: desktop runtime bootstrap

The production desktop registered the API AppHandle only under `#[cfg(debug_assertions)]`. The mobile `session/send` adapter needs that handle before it can dispatch a native-agent message, so a release build could report `desktop agent not ready` even with a healthy relay connection. Native cancel and permission-response paths share the same dependency.

This change registers the existing OnceLock-backed handle at startup in every build. The test HTTP routes remain debug-only. The registration is once per process, adds no worker, timer or subscription, and changes no wire or storage format. Failed sends stop before the message write path, so there is no historical data cleanup.

Verification: the focused startup contract test passed in this isolated branch. An installed release desktop and paired iPhone were not rebuilt and exercised here; that remains the final runtime check. Architecture review covered initialization parity, owner lifetime and unchanged transport boundaries. Performance verdict: bounded one-time registration, no ongoing work.
