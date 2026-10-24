# Profile isolation: symlink-aware path guard

## Background

The independent **TP Agent Studio** binary uses its own default data home (`~/.tp-agent-studio`) and dedicated dev, numbered-instance and service-port namespaces. A portable/test environment can still override the internal `ORGII_HOME` setting. This override must **never** point the fork back into the original publisher's `~/.orgii` user profile.

A previous guard directly called `canonicalize()` and, if it failed for a path that had not been created, compared the unnormalized string. A path with `../`, a symlinked ancestor or a non-existent suffix could evade the safety check.

## Implemented

- Require an absolute override path.
- Lexically resolve `.` and `..` path components before checking containment.
- Resolve the **nearest existing filesystem ancestor** and append missing components; if symlink resolution or permissions fail, refuse to start instead of silently accepting an unverified path.
- Compare to the independently resolved `~/.orgii` user data directory, including nested children and case-insensitive Windows path matching.
- Cover non-existent children, dot-dot traversal and symlinked parents in Rust tests; verify guard presence in the lightweight Fork Safety workflow.
- Maintain opt-in portable/test roots that do not overlap upstream's profile.

## What is not yet guaranteed

This is a startup **accidental-overlap guard**, not a hardened per-operation directory sandbox: an attacker who can change a symlink *after* startup can still cause a TOCTOU race. Workspace-local `.orgii` metadata, external CLI user profiles, OS credential stores and cloud accounts have separate paths and still need explicit auditing. Do not claim full fork/upstream isolation until those paths have been tested on macOS Apple Silicon, Windows 11 and Linux.

## Verification

```sh
node scripts/fork/check-identity.mjs
cd src-tauri
cargo test -p org2 runtime_instance::tests
cargo clippy --workspace --all-targets -- -D warnings
```

CI evidence, not this document, is the authority for a passing build.
