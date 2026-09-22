//! Managed CLI config profiles.
//!
//! This module owns the Default <-> ORGII Managed switch for CLI config files.
//! The first managed agents expose stable user-level config files and can route
//! model traffic through a local proxy without MITM interception.
//!
//! The module is split by concern: the adapter registry lives in
//! [`registry`], the on-disk manifest in [`manifest`], crash-safe writes in
//! [`transaction`], and content generation in [`generators`]/[`adapters`].
//! This file keeps the public surface plus the operation lock that
//! serializes every switch.

mod adapters;
pub mod claude_models;
mod codex_runtime;
pub mod desktop;
mod direct;
mod dto;
pub mod model_catalog;
pub mod provider_profiles;
mod target_lock;
pub use direct::{verify_claude_launch_connection, DirectConnection};
mod file_io;
mod generators;
pub mod launch;
mod manifest;
pub mod native_app;
mod operations;
mod proxy;
mod registry;
mod snapshot;
mod transaction;

#[cfg(test)]
mod desktop_tests;
#[cfg(test)]
mod direct_tests;
#[cfg(test)]
mod provider_profiles_tests;
#[cfg(test)]
mod tests;

use std::sync::{Mutex, MutexGuard, OnceLock};

use manifest::read_manifest;
use operations::{
    enable_agent_orgii_managed_unlocked, managed_selection_for_agent_unlocked,
    restore_agent_default_unlocked, status_for_unlocked,
};
use registry::{supported_agent, unavailable_agent_message, MANAGED_CONFIG_ADAPTERS};
use transaction::recover_pending_transaction_unlocked;

/// Keep a small amount of Codex-native recovery without combining it with
/// ORGII's whole-process overload replay.
pub const CODEX_REQUEST_MAX_RETRIES: i64 = 2;
pub const CODEX_STREAM_MAX_RETRIES: i64 = 2;

/// Write the complete, ORGII-owned Codex profile used by one hosted session.
///
/// This deliberately does not merge with the user's global Codex config: the
/// caller points `CODEX_HOME` at a session-scoped directory, eliminating
/// cross-session and cross-instance last-writer-wins routing.
pub fn write_codex_hosted_profile(
    profile_dir: &std::path::Path,
    proxy_url: &str,
) -> Result<(), String> {
    let content = generators::generate_codex_hosted_profile(proxy_url)?;
    let config_path = profile_dir.join("config.toml");
    if std::fs::read_to_string(&config_path).ok().as_deref() == Some(content.as_str()) {
        return Ok(());
    }
    file_io::write_sensitive_file_atomic(&config_path, content.as_bytes())
}

/// Crash-safe replace of a CLI profile file: write an owner-only sibling temp
/// file, fsync, then rename over the target. The payload is never on disk
/// group- or world-readable, so callers holding credentials only need
/// [`app_paths::set_sensitive_file_permissions`] to pin the destination's
/// permissions (and to cover Windows ACLs) — and get to decide for themselves
/// whether a failure there is fatal.
pub fn write_cli_profile_file_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    file_io::write_file_atomic(path, bytes)
}

pub use dto::{
    CliConfigManagedStatus, CliConfigMode, CliConfigProfileManifest,
    CliConfigShutdownRestoreReport, CliConfigTargetFileManifest, CliConfigTargetFileStatus,
    CliManagedConfigSelection,
};
pub use proxy::{
    claude_desktop_proxy_base_url, generate_proxy_token, managed_proxy_port, managed_proxy_url,
    set_managed_proxy_port_default,
};
pub use registry::{
    managed_config_availability_for_agent, managed_config_unavailable_reason_for_agent,
    managed_proxy_protocol_for_agent, CliManagedConfigAvailability, CliManagedProxyProtocol,
};

static CONFIG_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn config_operation_guard() -> Result<MutexGuard<'static, ()>, String> {
    CONFIG_OPERATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "CLI config operation lock is poisoned".to_string())
}

pub fn managed_selection_for_agent(
    agent_name: &str,
) -> Result<Option<CliManagedConfigSelection>, String> {
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_targets(agent_name)?;
    recover_pending_transaction_unlocked(agent_name)?;
    managed_selection_for_agent_unlocked(agent_name)
}

pub fn enable_orgii_managed(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    enable_orgii_managed_checked(agent_name, key_id, provider, model, force, None)
}

pub fn enable_orgii_managed_checked(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
    expected: Option<&std::collections::BTreeMap<String, Option<String>>>,
) -> Result<CliConfigManagedStatus, String> {
    if agent_name == desktop::TARGET {
        return Err("Claude Desktop currently supports direct connections only".into());
    }
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_targets(agent_name)?;
    recover_pending_transaction_unlocked(agent_name)?;
    verify_expected_targets(agent_name, expected)?;
    if !supported_agent(agent_name) {
        return Err(unavailable_agent_message(agent_name));
    }
    enable_agent_orgii_managed_unlocked(agent_name, key_id, provider, model, force)
}

/// Apply a model picker and its routing manifest under one transaction.
pub fn enable_orgii_managed_catalog(
    agent: &str,
    key: String,
    provider: String,
    model: String,
    catalog: &model_catalog::ModelCatalog,
    expected: &std::collections::BTreeMap<String, Option<String>>,
) -> Result<CliConfigManagedStatus, String> {
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_targets(agent)?;
    recover_pending_transaction_unlocked(agent)?;
    verify_expected_targets(agent, Some(expected))?;
    operations::apply_connection_unlocked(
        agent,
        Some(key),
        Some(provider),
        Some(model),
        false,
        None,
        operations::AppOptions {
            catalog: Some(catalog),
            native_app: None,
        },
    )
}

/// Market official-App boundary. Generic CLI/Direct entry points never select
/// this destination. An active legacy/native connection must be restored first.
pub fn enable_native_app(
    profile: &native_app::NativeAppProfile,
    key: String,
    provider: String,
    model: String,
    catalog: Option<&model_catalog::ModelCatalog>,
    direct: Option<&DirectConnection>,
    expected: &std::collections::BTreeMap<String, Option<String>>,
) -> Result<CliConfigManagedStatus, String> {
    let agent = profile.agent();
    profile.validate(agent)?;
    if agent == "claude_desktop"
        && direct
            .and_then(|value| value.desktop_helper.as_ref())
            .is_none_or(|helper| helper.path != profile.helper())
    {
        return Err("Native App credential helper does not match its profile".into());
    }
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_app_targets(agent, Some(profile))?;
    recover_pending_transaction_unlocked(agent)?;
    verify_expected_targets(agent, Some(expected))?;
    operations::apply_connection_unlocked(
        agent,
        Some(key),
        Some(provider),
        Some(model),
        false,
        direct,
        operations::AppOptions {
            catalog,
            native_app: Some(profile),
        },
    )
}

/// Restore active managed CLI configs before the ORGII process exits.
///
/// Shutdown restoration is deliberately non-forcing: a config edited outside
/// ORGII is left untouched and reported instead of being overwritten.
pub fn restore_managed_configs_for_shutdown() -> Result<CliConfigShutdownRestoreReport, String> {
    restore_managed_configs_matching(|_| Ok(true))
}

/// Restore selected managed profiles under the existing configuration/target locks.
/// The predicate must be local and must not re-enter configuration operations.
/// Unmatched profiles and externally modified files are never replaced.
pub fn restore_managed_configs_matching(
    matches: impl Fn(Option<&str>) -> Result<bool, String>,
) -> Result<CliConfigShutdownRestoreReport, String> {
    let _guard = config_operation_guard()?;
    let mut report = CliConfigShutdownRestoreReport::default();

    for adapter in MANAGED_CONFIG_ADAPTERS {
        let agent_name = adapter.agent_name;
        let _target_lock = match target_lock::lock_targets(agent_name) {
            Ok(lock) => lock,
            Err(err) => {
                report.failed_agents.push((agent_name.to_string(), err));
                continue;
            }
        };
        if let Err(err) = recover_pending_transaction_unlocked(agent_name) {
            report.failed_agents.push((agent_name.to_string(), err));
            continue;
        }

        let managed_active = match read_manifest(agent_name) {
            Ok(Some(manifest)) => {
                if manifest.mode != CliConfigMode::OrgiiManaged {
                    false
                } else {
                    match matches(manifest.selected_key_id.as_deref()) {
                        Ok(selected) => selected,
                        Err(err) => {
                            report.failed_agents.push((agent_name.to_string(), err));
                            continue;
                        }
                    }
                }
            }
            Ok(None) => false,
            Err(err) => {
                report.failed_agents.push((agent_name.to_string(), err));
                continue;
            }
        };
        if !managed_active {
            continue;
        }
        match restore_agent_default_unlocked(agent_name, false) {
            Ok(_) => report.restored_agents.push(agent_name.to_string()),
            Err(err) => report.failed_agents.push((agent_name.to_string(), err)),
        }
    }

    Ok(report)
}

/// Releases before the Claude Code overlay rewrote the user's own settings.json
/// (with a default backup). On the first start after upgrading, restore such a
/// file from its backup so the connection can be re-applied as an overlay. The
/// restore is non-forcing: a file edited outside ORG2 since the last apply is
/// left in place and reported; the existing conflict UI then covers it.
pub fn migrate_native_overlay_targets() -> Result<CliConfigShutdownRestoreReport, String> {
    let _guard = config_operation_guard()?;
    let mut report = CliConfigShutdownRestoreReport::default();
    for adapter in MANAGED_CONFIG_ADAPTERS {
        let agent_name = adapter.agent_name;
        if !adapter
            .targets
            .iter()
            .any(|target| target.kind == registry::ManagedConfigTargetKind::Overlay)
        {
            continue;
        }
        let _target_lock = match target_lock::lock_targets(agent_name) {
            Ok(lock) => lock,
            Err(err) => {
                report.failed_agents.push((agent_name.to_string(), err));
                continue;
            }
        };
        if let Err(err) = recover_pending_transaction_unlocked(agent_name) {
            report.failed_agents.push((agent_name.to_string(), err));
            continue;
        }
        let legacy = match (
            read_manifest(agent_name),
            manifest::agent_manifest_targets(agent_name),
        ) {
            (Ok(Some(manifest)), Ok(current)) => {
                manifest.mode != CliConfigMode::Default
                    && manifest.target_files.iter().any(|target| {
                        registry::is_overlay_target(agent_name, &target.id)
                            && !current
                                .iter()
                                .any(|c| c.id == target.id && c.target_path == target.target_path)
                    })
            }
            (Ok(None), _) => false,
            (Err(err), _) | (_, Err(err)) => {
                report.failed_agents.push((agent_name.to_string(), err));
                continue;
            }
        };
        if !legacy {
            continue;
        }
        match restore_agent_default_unlocked(agent_name, false) {
            Ok(_) => report.restored_agents.push(agent_name.to_string()),
            Err(err) => report.failed_agents.push((agent_name.to_string(), err)),
        }
    }
    Ok(report)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_get_status(agent_name: String) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = config_operation_guard()?;
        let _target_lock = target_lock::lock_targets(&agent_name)?;
        recover_pending_transaction_unlocked(&agent_name)?;
        status_for_unlocked(&agent_name)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_restore_default(
    agent_name: String,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = config_operation_guard()?;
        let _target_lock = target_lock::lock_targets(&agent_name)?;
        recover_pending_transaction_unlocked(&agent_name)?;
        if !supported_agent(&agent_name) {
            return Err(unavailable_agent_message(&agent_name));
        }
        restore_agent_default_unlocked(&agent_name, force)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Restore only a still-selected profile. The compare and restoration share
/// the target lock, so disconnecting one source cannot undo a newer choice.
pub fn restore_if_selected(
    agent_name: &str,
    expected_key: &str,
) -> Result<CliConfigManagedStatus, String> {
    restore_if_selected_matching(agent_name, |key| Ok(key == expected_key))
}

/// Evaluate source ownership and restore while holding the same target lock.
/// The matcher must be local and must not re-enter configuration operations.
pub fn restore_if_selected_matching(
    agent_name: &str,
    matches: impl FnOnce(&str) -> Result<bool, String>,
) -> Result<CliConfigManagedStatus, String> {
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_targets(agent_name)?;
    recover_pending_transaction_unlocked(agent_name)?;
    let selection = status_for_unlocked(agent_name)?;
    if selection.mode == CliConfigMode::Default {
        return Ok(selection);
    }
    let selected_key = selection.selected_key_id.as_deref();
    if !selected_key.map(matches).transpose()?.unwrap_or(false) {
        // Already restored or switched: preserve the newer configuration.
        return status_for_unlocked(agent_name);
    }
    restore_agent_default_unlocked(agent_name, false)
}

/// Apply native credentials without starting or depending on the local proxy.
pub fn enable_direct(
    agent_name: &str,
    connection: DirectConnection,
    expected: Option<&std::collections::BTreeMap<String, Option<String>>>,
) -> Result<CliConfigManagedStatus, String> {
    enable_direct_inner(agent_name, connection, expected, false)
}

/// Replace a previously managed direct profile after the caller has shown the
/// current files to the user and supplied their exact hashes. This preserves
/// optimistic concurrency while allowing an explicit "Use this service"
/// action to switch away from a profile that another app changed.
pub fn replace_direct(
    agent_name: &str,
    connection: DirectConnection,
    expected: &std::collections::BTreeMap<String, Option<String>>,
) -> Result<CliConfigManagedStatus, String> {
    enable_direct_inner(agent_name, connection, Some(expected), true)
}

fn enable_direct_inner(
    agent_name: &str,
    connection: DirectConnection,
    expected: Option<&std::collections::BTreeMap<String, Option<String>>>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    let _guard = config_operation_guard()?;
    let _target_lock = target_lock::lock_targets(agent_name)?;
    recover_pending_transaction_unlocked(agent_name)?;
    verify_expected_targets(agent_name, expected)?;
    operations::apply_connection_unlocked(
        agent_name,
        Some(connection.key_id.clone()),
        Some(connection.provider.clone()),
        Some(connection.model.clone()),
        force,
        Some(&connection),
        operations::AppOptions::default(),
    )
}

/// Startup needs a proxy only when a previous managed profile remains active.
pub fn has_active_managed_profiles() -> bool {
    MANAGED_CONFIG_ADAPTERS.iter().any(|adapter| {
        read_manifest(adapter.agent_name)
            .ok()
            .flatten()
            .is_some_and(|manifest| manifest.mode == CliConfigMode::OrgiiManaged)
    })
}

fn verify_expected_targets(
    agent: &str,
    expected: Option<&std::collections::BTreeMap<String, Option<String>>>,
) -> Result<(), String> {
    if let Some(expected) = expected {
        let actual = status_for_unlocked(agent)?
            .target_files
            .into_iter()
            .map(|target| (target.id, target.current_hash))
            .collect::<std::collections::BTreeMap<_, _>>();
        if &actual != expected {
            return Err(
                "Configuration changed since it was displayed. Refresh and review before applying."
                    .into(),
            );
        }
    }
    Ok(())
}
