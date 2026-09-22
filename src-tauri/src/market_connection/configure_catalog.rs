//! Explicit multi-purchase configuration. Fetch capabilities before any file
//! mutation; commit native picker, proxy selection and backups together.
use super::ConfigureCatalogRequest;
use super::{
    app_catalog::{alias_for_agent, picker_label, Catalog, CatalogModel},
    source, ConfiguredProfile,
};
use agent_cli::managed_config::model_catalog::{ModelCatalog, PickerModel};

async fn codex_metadata() -> Result<serde_json::Value, String> {
    use tokio::io::AsyncReadExt;
    let binary = integrations::cli_binary_resolver::resolve_cli_binary_for_registry_name("codex")
        .ok_or("Codex unavailable")?;
    let mut child = tokio::process::Command::new(binary.command)
        .args(["debug", "models", "--bundled"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Could not read the installed Codex model catalog")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Codex model catalog unavailable")?;
    let mut bytes = Vec::new();
    let status = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        stdout
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Codex model catalog unavailable")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Codex model catalog too large");
        }
        child
            .wait()
            .await
            .map_err(|_| "Codex model catalog unavailable")
    })
    .await
    .map_err(|_| "Codex model catalog timed out")??;
    if !status.success() {
        return Err("Update Codex to a version supporting native model catalogs".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid installed Codex model catalog".into())
}

pub(super) async fn configure(
    request: ConfigureCatalogRequest,
) -> Result<ConfiguredProfile, String> {
    let lease = super::owner::require()?;
    let ConfigureCatalogRequest {
        packages,
        agent,
        default_package,
        default_model,
        expected_hashes,
    } = request;
    if packages.is_empty() || packages.len() > 8 || default_package >= packages.len() {
        return Err("Select between one and eight Market packages".into());
    }
    super::validate_external_profile_request(
        &market_connect::Target::Org2,
        &agent,
        &default_model,
    )?;
    super::native_app_launch::verify_installed(&agent).await?;
    if agent == "claude_code" {
        use integrations::cli_binary_resolver::{
            probe_cli_binary_version, resolve_cli_binary_for_registry_name,
        };
        let binary =
            resolve_cli_binary_for_registry_name(&agent).ok_or("Claude Code unavailable")?;
        let probe = probe_cli_binary_version(&binary).await;
        let version = probe.version.ok_or_else(|| match probe.error.as_deref() {
            Some(error) if !error.is_empty() => {
                format!("Claude Code version unavailable: {error}")
            }
            _ => "Claude Code version unavailable".to_string(),
        })?;
        let parts = version
            .trim_start_matches('v')
            .split('.')
            .map(str::parse::<u32>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Unrecognized Claude Code version")?;
        if parts.len() != 3 || parts.as_slice() < [2, 1, 242].as_slice() {
            return Err(
                "Update Claude Code to 2.1.242 or newer to select packages inside the app".into(),
            );
        }
    }
    let metadata = if agent == "codex" {
        Some(codex_metadata().await?)
    } else {
        None
    };
    let mut catalog = Catalog {
        version: 1,
        agent: agent.clone(),
        default_model: String::new(),
        models: Vec::new(),
    };
    let mut picker = ModelCatalog { models: Vec::new() };
    let mut owners = std::collections::HashMap::new();
    let mut purchases = std::collections::HashSet::new();
    for (index, package) in packages.into_iter().enumerate() {
        if package.target != "org2"
            || !purchases.insert((
                package.entitlement_workspace_id.clone(),
                package.entitlement_id.clone(),
            ))
        {
            return Err("Invalid or duplicate Market package".into());
        }
        lease.matches(&package.identity_user_id)?;
        let connection = market_connect::ConnectionMetadata {
            identity_user_id: package.identity_user_id,
            workspace_id: package.workspace_id,
            target: market_connect::Target::Org2,
        };
        let owner = serde_json::to_string(&connection).map_err(|_| "Invalid Market identity")?;
        if !owners.contains_key(&owner) {
            owners.insert(owner.clone(), source::options(connection.clone()).await?);
        }
        let entries = &owners[&owner];
        let entry = entries
            .iter()
            .find(|entry| {
                entry.workspace_id == package.entitlement_workspace_id
                    && entry.entitlement_id == package.entitlement_id
            })
            .ok_or("Market package unavailable")?;
        let wire_agent = if agent == "codex" { "codex" } else { "claude" };
        let models = entry
            .models_by_agent
            .get(wire_agent)
            .ok_or("No compatible models in this package")?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let previous_count = catalog.models.len();
        for model in models {
            // Unavailable/withdrawn models never enter the native picker.
            if source::validate_external_purchase(
                entries,
                &package.entitlement_workspace_id,
                &package.entitlement_id,
                &agent,
                model,
                chrono::Utc::now().timestamp_millis(),
            )
            .is_err()
            {
                continue;
            }
            let selection = source::Selection {
                native_protocol: None,
                metadata: connection.clone(),
                workspace_id: package.entitlement_workspace_id.clone(),
                entitlement_id: package.entitlement_id.clone(),
                model: Some(model.clone()),
                session_id: Some(session_id.clone()),
            };
            let id = alias_for_agent(&selection, &agent)?;
            let native_metadata = if let Some(metadata) = &metadata {
                Some(metadata.get("models").and_then(serde_json::Value::as_array)
                    .and_then(|models| models.iter().find(|entry| entry.get("slug").and_then(serde_json::Value::as_str) == Some(model)))
                    .cloned().ok_or_else(|| format!("Installed Codex has no native metadata for {model}; update Codex before configuring this package"))?)
            } else {
                None
            };
            let label = picker_label(
                &entry.service_name,
                model,
                native_metadata
                    .as_ref()
                    .and_then(|entry| entry.get("display_name"))
                    .and_then(serde_json::Value::as_str),
            );
            picker.models.push(PickerModel {
                id: id.clone(),
                label: label.clone(),
                native_metadata,
            });
            if index == default_package && model == &default_model {
                catalog.default_model = id.clone();
            }
            catalog.models.push(CatalogModel {
                id,
                label,
                selection: selection.key()?,
            });
            if catalog.models.len() > 64 {
                return Err("Selected packages exceed the 64-model native catalog limit".into());
            }
        }
        if catalog.models.len() == previous_count {
            return Err("A selected Market package has no currently available models".into());
        }
    }
    disambiguate_picker_labels(&mut catalog, &mut picker);
    let selection = catalog.key()?;
    // Validate all entries before requesting any credential or editing config.
    let native_app = lease.native_app(&agent)?;
    let status = if agent == "claude_desktop" {
        crate::cli_managed_proxy::enable_dynamic_desktop(
            selection.clone(),
            catalog.default_model,
            picker.models,
            expected_hashes,
            native_app,
            lease.operation(),
        )
        .await?
    } else {
        crate::cli_managed_proxy::enable_dynamic_catalog(
            agent,
            selection.clone(),
            catalog.default_model,
            picker,
            expected_hashes,
            native_app,
            lease.operation(),
        )
        .await?
    };
    Ok(ConfiguredProfile { status, selection })
}

fn disambiguate_picker_labels(catalog: &mut Catalog, picker: &mut ModelCatalog) {
    // Identical display names still need distinct native picker labels.
    let mut label_counts = std::collections::HashMap::new();
    for model in &catalog.models {
        *label_counts.entry(model.label.clone()).or_insert(0) += 1;
    }
    for (model, picker_model) in catalog.models.iter_mut().zip(&mut picker.models) {
        if label_counts
            .get(&model.label)
            .is_some_and(|count| *count > 1)
        {
            model.label = format!("{} · {}", model.label, &model.id[model.id.len() - 6..]);
            picker_model.label = model.label.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same_initials_catalog(session: &str, reverse: bool) -> (Catalog, ModelCatalog) {
        let mut models: Vec<_> = [
            ("pa_beginner", "Coding for beginner"),
            ("pa_business", "Coding for business"),
        ]
        .into_iter()
        .map(|(purchase, package)| {
            let selection = source::Selection {
                native_protocol: None,
                metadata: market_connect::ConnectionMetadata {
                    identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                    workspace_id: "ws_anchor".into(),
                    target: market_connect::Target::Org2,
                },
                workspace_id: "ws_purchases".into(),
                entitlement_id: purchase.into(),
                model: Some("gpt-5.6-luna".into()),
                session_id: Some(session.into()),
            };
            CatalogModel {
                id: alias_for_agent(&selection, "codex").unwrap(),
                label: picker_label(package, "gpt-5.6-luna", Some("GPT-5.6-Luna")),
                selection: selection.key().unwrap(),
            }
        })
        .collect();
        let default_model = models[0].id.clone();
        if reverse {
            models.reverse();
        }
        let picker = ModelCatalog {
            models: models
                .iter()
                .map(|model| PickerModel {
                    id: model.id.clone(),
                    label: model.label.clone(),
                    native_metadata: None,
                })
                .collect(),
        };
        (
            Catalog {
                version: 1,
                agent: "codex".into(),
                default_model,
                models,
            },
            picker,
        )
    }

    #[test]
    fn same_initials_same_model_labels_keep_purchase_routing_and_picker_in_sync() {
        let mut baseline = std::collections::BTreeMap::new();
        for (session, reverse) in [
            ("22222222-2222-4222-8222-222222222222", false),
            ("33333333-3333-4333-8333-333333333333", true),
        ] {
            let (mut catalog, mut picker) = same_initials_catalog(session, reverse);
            assert_eq!(catalog.models[0].label, catalog.models[1].label);
            assert_ne!(catalog.models[0].id, catalog.models[1].id);
            let original: Vec<_> = catalog
                .models
                .iter()
                .map(|model| (model.id.clone(), model.selection.clone()))
                .collect();
            let default_model = catalog.default_model.clone();

            disambiguate_picker_labels(&mut catalog, &mut picker);

            assert_ne!(catalog.models[0].label, catalog.models[1].label);
            assert_eq!(catalog.default_model, default_model);
            let restored = Catalog::parse(&catalog.key().unwrap(), "codex").unwrap();
            for ((model, picker_model), (id, selection)) in
                catalog.models.iter().zip(&picker.models).zip(&original)
            {
                assert_eq!((&model.id, &model.selection), (id, selection));
                assert_eq!(picker_model.id, model.id);
                assert_eq!(picker_model.label, model.label);
                let route = restored.resolve(&model.id).unwrap();
                assert_eq!(route.selection, model.selection);
                assert_eq!(route.model, "gpt-5.6-luna");
                let owner = source::Selection::parse(&route.selection, "codex").unwrap();
                let identity = (model.id.clone(), model.label.clone());
                if reverse {
                    assert_eq!(baseline.get(&owner.entitlement_id), Some(&identity));
                } else {
                    baseline.insert(owner.entitlement_id, identity);
                }
            }
        }
    }
}
