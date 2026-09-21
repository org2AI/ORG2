//! Native picker configuration. Callers supply aliases and authoritative native
//! model metadata; this layer does not know credential providers or purchases.
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

pub const TARGET_ID: &str = "org2-model-catalog";

#[derive(Clone)]
pub struct PickerModel {
    pub id: String,
    pub label: String,
    pub native_metadata: Option<serde_json::Value>,
}
pub struct ModelCatalog {
    pub models: Vec<PickerModel>,
}

pub(super) fn path() -> Result<PathBuf, String> {
    Ok(
        crate::generic_config::resolve_config_path("codex", "config")?
            .with_file_name("org2-model-catalog.json"),
    )
}

#[cfg(test)]
pub(super) fn apply(
    agent: &str,
    files: &mut BTreeMap<String, String>,
    catalog: Option<&ModelCatalog>,
    selected: Option<&str>,
) -> Result<(), String> {
    apply_at(agent, files, catalog, selected, None)
}

pub(super) fn apply_at(
    agent: &str,
    files: &mut BTreeMap<String, String>,
    catalog: Option<&ModelCatalog>,
    selected: Option<&str>,
    destination: Option<&std::path::Path>,
) -> Result<(), String> {
    if let Some(catalog) = catalog {
        let mut ids = HashSet::new();
        if catalog.models.is_empty()
            || catalog.models.len() > 64
            || !catalog
                .models
                .iter()
                .any(|model| Some(model.id.as_str()) == selected)
        {
            return Err("Invalid native model catalog".into());
        }
        for model in &catalog.models {
            if model.id.is_empty()
                || model.id.len() > 256
                || model.id.chars().any(char::is_control)
                || model.label.trim().is_empty()
                || model.label.len() > 512
                || model.label.chars().any(char::is_control)
                || !ids.insert(&model.id)
            {
                return Err("Invalid native model catalog entry".into());
            }
        }
    }
    match agent {
        "codex" => {
            let text = files
                .get_mut("config")
                .ok_or("Codex configuration missing")?;
            let mut config: toml::Value =
                toml::from_str(text).map_err(|_| "Invalid Codex config")?;
            let root = config.as_table_mut().ok_or("Invalid Codex config")?;
            let catalog_path = destination
                .map(PathBuf::from)
                .map(Ok)
                .unwrap_or_else(path)?
                .to_string_lossy()
                .into_owned();
            if let Some(catalog) = catalog {
                let mut models = Vec::new();
                for model in &catalog.models {
                    let mut metadata = model
                        .native_metadata
                        .clone()
                        .ok_or("Native Codex model metadata missing")?;
                    let entry = metadata
                        .as_object_mut()
                        .ok_or("Invalid native Codex model metadata")?;
                    entry.insert("slug".into(), model.id.clone().into());
                    entry.insert("display_name".into(), model.label.clone().into());
                    entry.insert("visibility".into(), "list".into());
                    entry.insert("supported_in_api".into(), true.into());
                    models.push(metadata);
                }
                root.insert("model_catalog_json".into(), catalog_path.into());
                *text = toml::to_string_pretty(&config).map_err(|_| "Invalid Codex config")?;
                files.insert(
                    TARGET_ID.into(),
                    serde_json::to_string(&serde_json::json!({"models":models}))
                        .map_err(|_| "Invalid Codex catalog")?,
                );
            } else if root.get("model_catalog_json").and_then(toml::Value::as_str)
                == Some(&catalog_path)
            {
                root.remove("model_catalog_json");
                *text = toml::to_string_pretty(&config).map_err(|_| "Invalid Codex config")?;
            }
        }
        "claude_code" => {
            if let Some(catalog) = catalog {
                let text = files.get_mut("settings").ok_or("Claude settings missing")?;
                let mut config: serde_json::Value =
                    serde_json::from_str(text).map_err(|_| "Invalid Claude settings")?;
                let options: Vec<_> = catalog
                    .models
                    .iter()
                    .map(|model| {
                        serde_json::json!({
                            "model":model.id, "label":model.label,
                        })
                    })
                    .collect();
                config["modelPicker"] =
                    serde_json::json!({"options":options,"replaceBuiltInOptions":true});
                config["availableModels"] = serde_json::json!(catalog
                    .models
                    .iter()
                    .map(|model| &model.id)
                    .collect::<Vec<_>>());
                *text =
                    serde_json::to_string_pretty(&config).map_err(|_| "Invalid Claude settings")?;
            }
        }
        _ if catalog.is_some() => {
            return Err("Native model catalogs are unavailable for this app".into())
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn restore_claude_picker(
    files: &mut BTreeMap<String, String>,
    original: &str,
) -> Result<(), String> {
    let original: serde_json::Value = if original.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(original).map_err(|_| "Invalid native model picker backup")?
    };
    let text = files.get_mut("settings").ok_or("Claude settings missing")?;
    let mut config: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "Invalid Claude settings")?;
    let root = config.as_object_mut().ok_or("Invalid Claude settings")?;
    for key in ["modelPicker", "availableModels"] {
        if let Some(value) = original.get(key) {
            root.insert(key.into(), value.clone());
        } else {
            root.remove(key);
        }
    }
    *text = serde_json::to_string_pretty(&config).map_err(|_| "Invalid Claude settings")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn catalog() -> ModelCatalog {
        ModelCatalog { models: ["a", "b"].into_iter().map(|package| PickerModel {
            id: format!("gpt-shared-{package}"), label: format!("Package {package} · gpt-shared"),
            native_metadata: Some(serde_json::json!({"slug":"gpt-shared", "context_window":12345, "supports_parallel_tool_calls":false})),
        }).collect() }
    }
    #[test]
    fn codex_catalog_preserves_actual_capabilities_and_restores_owned_pointer() {
        // `path()` resolves through the process environment; sibling tests move
        // ORGII_EXTERNAL_HISTORY_HOME under this lock, so hold it for the whole
        // apply/compare sequence or the expected path can change mid-test.
        let _lock = crate::managed_config::tests::TEST_ENV_LOCK
            .get_or_init(Default::default)
            .lock()
            .unwrap();
        let mut files = BTreeMap::from([(
            "config".into(),
            "model = 'gpt-shared-a'\nuser_setting = true\n".into(),
        )]);
        apply("codex", &mut files, Some(&catalog()), Some("gpt-shared-a")).unwrap();
        let config: toml::Value = toml::from_str(&files["config"]).unwrap();
        assert_eq!(config["user_setting"].as_bool(), Some(true));
        assert_eq!(
            config["model_catalog_json"].as_str(),
            Some(path().unwrap().to_str().unwrap())
        );
        let wire: serde_json::Value = serde_json::from_str(&files[TARGET_ID]).unwrap();
        assert_eq!(wire["models"][0]["slug"], "gpt-shared-a");
        assert_eq!(wire["models"][1]["slug"], "gpt-shared-b");
        assert_eq!(wire["models"][1]["context_window"], 12345);
        assert_eq!(wire["models"][1]["supports_parallel_tool_calls"], false);
        apply("codex", &mut files, None, Some("ordinary-model")).unwrap();
        let config: toml::Value = toml::from_str(&files["config"]).unwrap();
        assert!(config.get("model_catalog_json").is_none());
    }
    #[test]
    fn claude_native_picker_lists_every_alias_and_restores_user_options() {
        let original = r#"{"theme":"dark","modelPicker":{"replaceBuiltInOptions":false},"availableModels":["personal-model"]}"#;
        let mut files = BTreeMap::from([("settings".into(), original.into())]);
        apply(
            "claude_code",
            &mut files,
            Some(&catalog()),
            Some("gpt-shared-a"),
        )
        .unwrap();
        let wire: serde_json::Value = serde_json::from_str(&files["settings"]).unwrap();
        assert_eq!(wire["modelPicker"]["options"][1]["model"], "gpt-shared-b");
        assert_eq!(
            wire["availableModels"],
            serde_json::json!(["gpt-shared-a", "gpt-shared-b"])
        );
        restore_claude_picker(&mut files, original).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&files["settings"]).unwrap(),
            serde_json::from_str::<serde_json::Value>(original).unwrap()
        );
    }
    #[test]
    fn malformed_or_ambiguous_catalog_never_generates_config() {
        let mut catalog = catalog();
        catalog.models[1].id = catalog.models[0].id.clone();
        let mut files = BTreeMap::from([("settings".into(), "{}".into())]);
        assert!(apply(
            "claude_code",
            &mut files,
            Some(&catalog),
            Some("gpt-shared-a")
        )
        .is_err());
        assert_eq!(files["settings"], "{}");
    }
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    use crate::managed_config::{self, file_io, manifest, operations};

    #[test]
    fn native_catalog_and_config_share_conflict_checks_backup_switch_and_restore() {
        let _lock = managed_config::tests::TEST_ENV_LOCK
            .get_or_init(Default::default)
            .lock()
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let _home = managed_config::tests::OrgiiHomeGuard::set(&root.path().join("orgii"));
        struct ExternalHome(Option<std::ffi::OsString>);
        impl Drop for ExternalHome {
            fn drop(&mut self) {
                if let Some(value) = self.0.take() {
                    std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", value);
                } else {
                    std::env::remove_var("ORGII_EXTERNAL_HISTORY_HOME");
                }
            }
        }
        let _external = ExternalHome(std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME"));
        std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", root.path().join("external"));
        let config = crate::generic_config::resolve_config_path("codex", "config").unwrap();
        let catalog_path = path().unwrap();
        assert!(config.starts_with(root.path()));
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        let original = "model = 'personal'\nmodel_catalog_json = '/personal/catalog.json'\n";
        std::fs::write(&config, original).unwrap();
        std::fs::write(&catalog_path, "preexisting owned-path file").unwrap();
        let catalog = ModelCatalog {
            models: vec![PickerModel {
                id: "alias".into(),
                label: "Package · model".into(),
                native_metadata: Some(
                    serde_json::json!({"slug":"real-model","context_window":12345}),
                ),
            }],
        };
        let status = operations::status_for_unlocked("codex").unwrap();
        let expected = status
            .target_files
            .into_iter()
            .map(|file| (file.id, file.current_hash))
            .collect();
        managed_config::enable_orgii_managed_catalog(
            "codex",
            "synthetic:catalog".into(),
            "synthetic".into(),
            "alias".into(),
            &catalog,
            &expected,
        )
        .unwrap();
        let applied_catalog = std::fs::read(&catalog_path).unwrap();
        assert!(
            manifest::read_manifest("codex")
                .unwrap()
                .unwrap()
                .native_model_catalog
        );
        std::fs::write(&catalog_path, "external edit").unwrap();
        assert!(operations::status_for_unlocked("codex").unwrap().conflict);
        assert!(operations::restore_agent_default_unlocked("codex", false).is_err());
        std::fs::write(&catalog_path, &applied_catalog).unwrap();
        operations::enable_agent_orgii_managed_unlocked(
            "codex",
            Some("plain-key".into()),
            Some("synthetic".into()),
            Some("plain-model".into()),
            false,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&catalog_path).unwrap(),
            "preexisting owned-path file"
        );
        let config_value: toml::Value =
            toml::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        assert!(config_value.get("model_catalog_json").is_none());
        assert!(
            !manifest::read_manifest("codex")
                .unwrap()
                .unwrap()
                .native_model_catalog
        );
        operations::restore_agent_default_unlocked("codex", false).unwrap();
        assert_eq!(std::fs::read_to_string(&config).unwrap(), original);
        assert_eq!(
            file_io::file_hash(&catalog_path).unwrap(),
            Some(file_io::sha256_bytes(b"preexisting owned-path file"))
        );
    }
}
