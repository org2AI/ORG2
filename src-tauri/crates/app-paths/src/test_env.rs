//! Shared scaffolding for tests that mutate process environment variables.
//!
//! Env vars are process-global and `cargo test` runs this crate's tests on
//! several threads in one binary, so every module that touches them must
//! serialize on the *same* lock. `home` and `cursor` both set
//! `ORGII_EXTERNAL_HISTORY_HOME`; per-module mutexes would let those two
//! interleave and flake.

use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard};

/// Serializes every env-mutating test in this crate. Hold the guard for the
/// whole test, including the assertions that read the vars back.
pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Sets or unsets one env var and restores the original value on drop.
pub(crate) struct EnvVarGuard {
    key: &'static str,
    original: Option<OsString>,
}

impl EnvVarGuard {
    pub(crate) fn set(key: &'static str, value: &str) -> Self {
        let original = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, original }
    }

    pub(crate) fn unset(key: &'static str) -> Self {
        let original = std::env::var_os(key);
        std::env::remove_var(key);
        Self { key, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.original.take() {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}
