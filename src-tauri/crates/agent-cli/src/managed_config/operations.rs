//! Lock-held managed-config operations: status, selection, and the
//! Default <-> ORGII Managed switch itself.
//!
//! Every function here assumes the caller already holds the config
//! operation guard and has recovered any pending transaction.

use std::collections::BTreeMap;
use std::path::PathBuf;

use super::dto::{
    CliConfigManagedStatus, CliConfigMode, CliConfigProfileManifest, CliConfigTargetFileManifest,
    CliConfigTargetFileStatus, CliManagedConfigSelection,
};
use super::file_io::{file_hash, now_stamp, sha256_bytes, write_sensitive_file_atomic};
use super::generators::generate_managed_configs;
use super::manifest::{read_manifest, targets_with_fallbacks, write_manifest};
use super::proxy::{generate_proxy_token, managed_proxy_url};
use super::registry::{supported_agent, unavailable_agent_message};
use super::snapshot::{ensure_default_backup_from_snapshot, read_target_snapshots, TargetMutation};
use super::transaction::execute_transaction;

fn clear_connection_metadata(manifest: &mut CliConfigProfileManifest) {
    manifest.native_model_catalog = false;
    manifest.provider_profile = None;
    manifest.selected_key_id = None;
    manifest.selected_provider = None;
    manifest.selected_model = None;
    manifest.proxy_url = None;
    manifest.proxy_token = None;
}

pub(super) fn status_for_unlocked(agent_name: &str) -> Result<CliConfigManagedStatus, String> {
    if !supported_agent(agent_name) {
        return Ok(CliConfigManagedStatus {
            native_app: None,
            agent_name: agent_name.to_string(),
            supported: false,
            mode: CliConfigMode::Default,
            has_default_backup: false,
            conflict: false,
            overlay: false,
            selected_key_id: None,
            selected_provider: None,
            selected_model: None,
            proxy_url: None,
            target_files: Vec::new(),
            message: Some(unavailable_agent_message(agent_name)),
        });
    }

    let mut manifest = read_manifest(agent_name)?;
    if let Some(value) = manifest.as_mut() {
        if value.mode == CliConfigMode::Default
            && (value.provider_profile.is_some()
                || value.selected_key_id.is_some()
                || value.selected_provider.is_some()
                || value.selected_model.is_some()
                || value.proxy_url.is_some()
                || value.proxy_token.is_some())
        {
            // Versions before this migration restored the app files but kept
            // the old route metadata. Remove it as soon as status is read so
            // a disconnected app cannot look connected or retain a loopback
            // authorization token on disk.
            clear_connection_metadata(value);
            value.updated_at = now_stamp();
            write_manifest(value)?;
        }
    }
    let fallback_targets = super::manifest::app_targets(
        agent_name,
        manifest
            .as_ref()
            .filter(|value| value.mode != CliConfigMode::Default)
            .and_then(|value| value.native_app.as_ref()),
    )?;
    let (mode, selected_key_id, selected_provider, selected_model, proxy_url, targets) =
        if let Some(manifest) = &manifest {
            (
                manifest.mode,
                manifest.selected_key_id.clone(),
                manifest.selected_provider.clone(),
                manifest.selected_model.clone(),
                manifest.proxy_url.clone(),
                if manifest.mode == CliConfigMode::Default && manifest.native_app.is_some() {
                    fallback_targets.clone()
                } else {
                    targets_with_fallbacks(Some(manifest), &fallback_targets)
                },
            )
        } else {
            (
                CliConfigMode::Default,
                None,
                None,
                None,
                Some(managed_proxy_url()),
                fallback_targets,
            )
        };

    let mut any_backup = false;
    let mut any_conflict = false;
    let mut all_overlay = true;
    let target_files: Vec<CliConfigTargetFileStatus> = targets
        .into_iter()
        .map(|target| {
            let target_path = PathBuf::from(&target.target_path);
            let default_backup_path = PathBuf::from(&target.default_backup_path);
            let current_hash = file_hash(&target_path)?;
            let has_default_backup = target.default_was_missing || default_backup_path.exists();
            let overlay = target_is_overlay(agent_name, &target);
            all_overlay &= overlay;
            // An overlay is ORG2-owned: nothing the user runs edits it, so a
            // hash mismatch there is not a third-party change to protect.
            let mut conflict = !overlay
                && mode != CliConfigMode::Default
                && target.last_applied_hash.is_some()
                && current_hash != target.last_applied_hash;
            if conflict
                && agent_name == super::desktop::TARGET
                && super::desktop::owns_runtime_mode(&target)
            {
                let current = if current_hash.is_some() {
                    std::fs::read(&target_path)
                        .map_err(|_| "Cannot inspect Claude Desktop runtime configuration")?
                } else {
                    Vec::new()
                };
                conflict = !super::desktop::runtime_mode_matches(&current);
            }
            if conflict && claude_code_settings_target(agent_name, &target.id) {
                let current = std::fs::read(&target_path)
                    .map_err(|_| "Cannot inspect Claude Code settings")?;
                conflict = !claude_code_runtime_drift_only(&target, &current);
            }
            if conflict {
                if let Some(manifest) = manifest
                    .as_ref()
                    .filter(|manifest| super::codex_runtime::owns_target(manifest, &target))
                {
                    let current = if current_hash.is_some() {
                        std::fs::read(&target_path)
                            .map_err(|_| "Cannot inspect isolated Codex configuration")?
                    } else {
                        Vec::new()
                    };
                    conflict = !super::codex_runtime::drift_only(manifest, &target, &current);
                }
            }
            any_backup |= has_default_backup;
            any_conflict |= conflict;
            Ok(CliConfigTargetFileStatus {
                id: target.id,
                target_path: target.target_path,
                default_backup_path: target.default_backup_path,
                managed_profile_path: target.managed_profile_path,
                target_exists: target_path.exists(),
                has_default_backup,
                default_was_missing: target.default_was_missing,
                original_hash: target.original_hash,
                last_applied_hash: target.last_applied_hash,
                current_hash,
                conflict,
                overlay,
            })
        })
        .collect::<Result<_, String>>()?;
    let overlay = all_overlay && !target_files.is_empty();

    Ok(CliConfigManagedStatus {
        native_app: manifest
            .as_ref()
            .filter(|value| value.mode != CliConfigMode::Default)
            .and_then(|value| value.native_app.clone()),
        agent_name: agent_name.to_string(),
        supported: true,
        mode,
        has_default_backup: any_backup,
        conflict: any_conflict,
        overlay,
        selected_key_id,
        selected_provider,
        selected_model,
        proxy_url,
        target_files,
        message: None,
    })
}

pub(super) fn managed_selection_for_agent_unlocked(
    agent_name: &str,
) -> Result<Option<CliManagedConfigSelection>, String> {
    if !supported_agent(agent_name) {
        return Ok(None);
    }

    let Some(manifest) = read_manifest(agent_name)? else {
        return Ok(None);
    };

    if manifest.mode != CliConfigMode::OrgiiManaged {
        return Ok(None);
    }

    Ok(Some(CliManagedConfigSelection {
        agent_name: manifest.agent,
        mode: manifest.mode,
        selected_key_id: manifest.selected_key_id,
        selected_provider: manifest.selected_provider,
        selected_model: manifest.selected_model,
        proxy_url: manifest.proxy_url,
        proxy_token: manifest.proxy_token,
    }))
}

pub(super) fn enable_agent_orgii_managed_unlocked(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    apply_connection_unlocked(
        agent_name,
        key_id,
        provider,
        model,
        force,
        None,
        AppOptions::default(),
    )
}

#[derive(Default)]
pub(super) struct AppOptions<'a> {
    pub catalog: Option<&'a super::model_catalog::ModelCatalog>,
    pub native_app: Option<&'a super::native_app::NativeAppProfile>,
}

pub(super) fn apply_connection_unlocked(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
    direct: Option<&super::direct::DirectConnection>,
    options: AppOptions<'_>,
) -> Result<CliConfigManagedStatus, String> {
    let AppOptions {
        catalog,
        native_app,
    } = options;
    if agent_name == super::desktop::TARGET {
        if direct.is_none() {
            return Err("Claude Desktop currently supports direct connections only".into());
        }
        super::desktop::ensure_unmanaged()?;
    }
    if let Some(profile) = direct.and_then(|d| d.profile.as_ref()) {
        if profile.target != agent_name {
            return Err("Profile belongs to a different app".into());
        }
        super::provider_profiles::require_saved_unlocked(profile)?;
    }
    let fallback_targets = super::manifest::app_targets(agent_name, native_app)?;
    let existing_manifest = read_manifest(agent_name)?;
    if let Some(manifest) = &existing_manifest {
        if manifest.mode != CliConfigMode::Default {
            if manifest.native_app.as_ref() != native_app {
                // Stable IPC code; the UI supplies localized Restore instructions.
                return Err("native_app_restore_required".into());
            }
            for target in &manifest.target_files {
                if !fallback_targets.iter().any(|current| {
                    current.id == target.id && current.target_path == target.target_path
                }) {
                    return Err("Harness configuration root changed. Restore the original root before switching.".into());
                }
            }
        }
    }
    // A Default manifest only records history. Build the next switch from the
    // adapter's current target set so removed targets from older releases do
    // not permanently block a new, explicitly requested connection.
    let targets = if existing_manifest
        .as_ref()
        .is_some_and(|manifest| manifest.mode == CliConfigMode::Default)
    {
        fallback_targets.clone()
    } else {
        targets_with_fallbacks(existing_manifest.as_ref(), &fallback_targets)
    };
    let snapshots = read_target_snapshots(&targets)?;
    let mut current_contents = BTreeMap::new();

    for target in &targets {
        let snapshot = snapshots
            .get(&target.id)
            .ok_or_else(|| format!("Missing CLI config snapshot for target {}", target.id))?;
        let content = String::from_utf8(snapshot.bytes.clone()).map_err(|err| {
            format!(
                "CLI config must be UTF-8 text ({}): {err}",
                snapshot.target_path.display()
            )
        })?;
        // An overlay is regenerated from scratch on every apply: it holds only
        // what ORG2 puts there, never a previous picker or role mapping.
        let content = if target_is_overlay(agent_name, target) {
            String::new()
        } else {
            content
        };
        current_contents.insert(target.id.clone(), content);
    }
    if agent_name == super::registry::CLAUDE_CODE_AGENT
        && super::registry::is_overlay_target(
            agent_name,
            super::registry::CLAUDE_CODE_CONFIG_FILE_ID,
        )
    {
        // The user's own settings.json stays untouched, so overrides in it
        // that would beat the overlay's proxy credential must be surfaced now.
        let native = crate::generic_config::resolve_config_path(
            agent_name,
            super::registry::CLAUDE_CODE_CONFIG_FILE_ID,
        )?;
        match std::fs::read_to_string(&native) {
            Ok(raw) => super::generators::inspect_claude_code_user_settings(&raw)?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot read the Claude Code user settings".into()),
        }
    }

    if let Some(existing_manifest) = &existing_manifest {
        if existing_manifest.mode != CliConfigMode::Default && !force {
            for target in &existing_manifest.target_files {
                if target_is_overlay(agent_name, target) {
                    continue;
                }
                if let Some(last_hash) = &target.last_applied_hash {
                    let current_hash = snapshots
                        .get(&target.id)
                        .and_then(|snapshot| snapshot.hash.as_ref());
                    let mode_matches = if current_hash != Some(last_hash)
                        && agent_name == super::desktop::TARGET
                        && super::desktop::owns_runtime_mode(target)
                    {
                        super::desktop::runtime_mode_matches(&snapshots[&target.id].bytes)
                    } else if current_hash != Some(last_hash)
                        && claude_code_settings_target(agent_name, &target.id)
                    {
                        claude_code_runtime_drift_only(target, &snapshots[&target.id].bytes)
                    } else if current_hash != Some(last_hash) {
                        super::codex_runtime::drift_only(
                            existing_manifest,
                            target,
                            &snapshots[&target.id].bytes,
                        )
                    } else {
                        false
                    };
                    if current_hash != Some(last_hash) && !mode_matches {
                        return Err(
                            "Current CLI config was modified outside ORG2. Restore or force apply before overwriting it."
                                .to_string(),
                        );
                    }
                }
            }
        }
    }

    if let Some(manifest) = existing_manifest
        .as_ref()
        .filter(|manifest| manifest.native_model_catalog)
    {
        let target = manifest
            .target_files
            .iter()
            .find(|target| target.id == "settings");
        // An overlay is regenerated from scratch, so there is no previous
        // picker to peel off; only a legacy native file needs its original back.
        if let Some(target) = target
            .filter(|target| agent_name == "claude_code" && !target_is_overlay(agent_name, target))
        {
            let original = if target.default_was_missing {
                String::new()
            } else {
                let bytes = std::fs::read(&target.default_backup_path)
                    .map_err(|_| "Native model picker backup unavailable")?;
                if target.original_hash.as_ref() != Some(&sha256_bytes(&bytes)) {
                    return Err("Native model picker backup hash mismatch".into());
                }
                String::from_utf8(bytes).map_err(|_| "Invalid model picker backup")?
            };
            super::model_catalog::restore_claude_picker(&mut current_contents, &original)?;
        }
    }
    let proxy_url = managed_proxy_url();
    let proxy_token = generate_proxy_token();
    let mut managed_contents = if let Some(connection) = direct {
        super::direct::generate_direct_configs(
            agent_name,
            &current_contents,
            connection,
            existing_manifest.as_ref(),
        )?
    } else {
        generate_managed_configs(
            agent_name,
            &current_contents,
            model.as_deref(),
            &proxy_url,
            &proxy_token,
        )?
    };

    if agent_name == super::desktop::TARGET && native_app.is_some() {
        super::desktop::enable_history_import(&mut managed_contents)?;
    }
    let catalog_path = if agent_name == "codex" {
        native_app
            .map(|profile| profile.target(super::model_catalog::TARGET_ID))
            .transpose()?
    } else {
        None
    };
    super::model_catalog::apply_at(
        agent_name,
        &mut managed_contents,
        catalog,
        model.as_deref(),
        catalog_path.as_deref(),
    )?;
    let now = now_stamp();
    let refresh_default_backup = existing_manifest
        .as_ref()
        .is_none_or(|manifest| manifest.mode == CliConfigMode::Default);
    let mut manifest = existing_manifest.unwrap_or_else(|| CliConfigProfileManifest {
        native_app: None,
        native_model_catalog: false,
        provider_profile: None,
        agent: agent_name.to_string(),
        mode: CliConfigMode::Default,
        target_files: fallback_targets.clone(),
        selected_key_id: None,
        selected_provider: None,
        selected_model: None,
        proxy_url: Some(managed_proxy_url()),
        proxy_token: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    });

    manifest.native_app = native_app.cloned();
    let mut managed_targets = Vec::new();
    let mut mutations = BTreeMap::new();
    for target in targets {
        let Some(managed_content) = managed_contents.get(&target.id) else {
            // Switching away from a catalog restores its owned artifact in the
            // same transaction, instead of leaving an orphan or losing backup ownership.
            if target.id == super::model_catalog::TARGET_ID && target.last_applied_hash.is_some() {
                let mutation = if target.default_was_missing {
                    TargetMutation::Remove
                } else {
                    let bytes = std::fs::read(&target.default_backup_path)
                        .map_err(|_| "Native catalog backup unavailable")?;
                    if target.original_hash.as_ref() != Some(&sha256_bytes(&bytes)) {
                        return Err("Native catalog backup hash mismatch".into());
                    }
                    TargetMutation::Write(bytes)
                };
                mutations.insert(target.id.clone(), mutation);
            }
            continue;
        };
        let snapshot = snapshots
            .get(&target.id)
            .ok_or_else(|| format!("Missing CLI config snapshot for target {}", target.id))?;
        let mut target = ensure_default_backup_from_snapshot(
            agent_name,
            target,
            snapshot,
            refresh_default_backup,
        )?;
        let managed_hash = sha256_bytes(managed_content.as_bytes());

        let managed_path = PathBuf::from(&target.managed_profile_path);
        write_sensitive_file_atomic(&managed_path, managed_content.as_bytes())?;

        target.last_applied_hash = Some(managed_hash);
        mutations.insert(
            target.id.clone(),
            TargetMutation::Write(managed_content.as_bytes().to_vec()),
        );
        managed_targets.push(target);
    }

    let proxy_backed_direct = direct
        .and_then(|value| value.proxy_token.as_ref())
        .is_some();
    manifest.mode = if direct.is_some() && !proxy_backed_direct {
        CliConfigMode::Direct
    } else {
        CliConfigMode::OrgiiManaged
    };
    manifest.native_model_catalog = catalog.is_some();
    manifest.provider_profile = direct.and_then(|d| d.profile.clone());
    manifest.target_files = managed_targets;
    manifest.selected_key_id = key_id;
    manifest.selected_provider = provider;
    manifest.selected_model = model;
    manifest.proxy_url = (direct.is_none() || proxy_backed_direct).then_some(proxy_url);
    manifest.proxy_token = direct
        .and_then(|value| value.proxy_token.clone())
        .or_else(|| direct.is_none().then_some(proxy_token));
    manifest.updated_at = now_stamp();
    execute_transaction(agent_name, &snapshots, &mutations, &manifest)?;
    status_for_unlocked(agent_name)
}

/// A manifest target is an overlay only when the adapter declares it so AND
/// the recorded path is the overlay file: a manifest left by a release that
/// still rewrote the native file keeps native (backup/conflict) semantics
/// until it is restored.
pub(super) fn target_is_overlay(agent_name: &str, target: &CliConfigTargetFileManifest) -> bool {
    super::registry::is_overlay_target(agent_name, &target.id)
        && std::path::Path::new(&target.target_path)
            .starts_with(app_paths::cli_config_profile_overlay_dir(agent_name))
}

fn claude_code_settings_target(agent_name: &str, target_id: &str) -> bool {
    agent_name == super::registry::CLAUDE_CODE_AGENT
        && target_id == super::registry::CLAUDE_CODE_CONFIG_FILE_ID
}

/// The committed managed profile is the only trusted copy of what ORG2 applied;
/// it is used only while its hash still matches the manifest.
fn claude_code_runtime_drift_only(target: &CliConfigTargetFileManifest, current: &[u8]) -> bool {
    let Some(last_applied) = target.last_applied_hash.as_deref() else {
        return false;
    };
    let Ok(applied) = std::fs::read(&target.managed_profile_path) else {
        return false;
    };
    sha256_bytes(&applied) == last_applied
        && super::generators::claude_code_runtime_drift_only(current, &applied)
}

pub(super) fn restore_agent_default_unlocked(
    agent_name: &str,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    if agent_name == super::desktop::TARGET {
        super::desktop::ensure_unmanaged()?;
    }
    let mut manifest = read_manifest(agent_name)?
        .ok_or_else(|| format!("No Default backup exists for {agent_name} yet"))?;
    if manifest.mode == CliConfigMode::Default {
        // Older manifests retained the previous Market selection after the
        // files were restored. Remove that routing metadata without touching
        // the user's already-restored app configuration.
        clear_connection_metadata(&mut manifest);
        manifest.updated_at = now_stamp();
        write_manifest(&manifest)?;
        return status_for_unlocked(agent_name);
    }
    let snapshots = read_target_snapshots(&manifest.target_files)?;
    let mut mutations = BTreeMap::new();

    for target in &manifest.target_files {
        if manifest.mode != CliConfigMode::Default
            && !force
            && !target_is_overlay(agent_name, target)
        {
            if let Some(last_hash) = &target.last_applied_hash {
                let current_hash = snapshots
                    .get(&target.id)
                    .and_then(|snapshot| snapshot.hash.as_ref());
                let mode_matches = if current_hash != Some(last_hash)
                    && agent_name == super::desktop::TARGET
                    && super::desktop::owns_runtime_mode(target)
                {
                    super::desktop::runtime_mode_matches(&snapshots[&target.id].bytes)
                } else if current_hash != Some(last_hash)
                    && claude_code_settings_target(agent_name, &target.id)
                {
                    claude_code_runtime_drift_only(target, &snapshots[&target.id].bytes)
                } else if current_hash != Some(last_hash) {
                    super::codex_runtime::drift_only(
                        &manifest,
                        target,
                        &snapshots[&target.id].bytes,
                    )
                } else {
                    false
                };
                if current_hash != Some(last_hash) && !mode_matches {
                    return Err(
                        "Current CLI config was modified outside ORG2. Force restore to overwrite it."
                            .to_string(),
                    );
                }
            }
        }

        let original = if target.default_was_missing {
            None
        } else {
            let backup_path = PathBuf::from(&target.default_backup_path);
            if !backup_path.exists() {
                return Err(format!(
                    "Default backup does not exist: {}",
                    backup_path.display()
                ));
            }
            let bytes = std::fs::read(&backup_path)
                .map_err(|err| format!("Failed to read {}: {err}", backup_path.display()))?;
            if target.original_hash.as_ref() != Some(&sha256_bytes(&bytes)) {
                return Err(format!(
                    "Default backup hash mismatch: {}",
                    backup_path.display()
                ));
            }
            Some(bytes)
        };
        let mutation =
            if agent_name == super::desktop::TARGET && super::desktop::owns_runtime_mode(target) {
                super::desktop::restore_runtime_mode(
                    target,
                    &snapshots[&target.id].bytes,
                    original.as_deref(),
                )?
            } else if super::codex_runtime::owns_target(&manifest, target) {
                super::codex_runtime::restore(
                    &manifest,
                    target,
                    snapshots[&target.id]
                        .existed
                        .then_some(snapshots[&target.id].bytes.as_slice()),
                    original.as_deref(),
                    force,
                )?
            } else {
                original.map_or(TargetMutation::Remove, TargetMutation::Write)
            };
        mutations.insert(target.id.clone(), mutation);
    }

    manifest.mode = CliConfigMode::Default;
    clear_connection_metadata(&mut manifest);
    manifest.updated_at = now_stamp();
    execute_transaction(agent_name, &snapshots, &mutations, &manifest)?;
    status_for_unlocked(agent_name)
}
