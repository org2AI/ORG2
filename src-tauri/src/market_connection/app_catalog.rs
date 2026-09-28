//! Metadata-only native model catalog. An alias names exactly one purchase and
//! model; resolving it changes credential ownership and the wire model together.
use super::source::{self, Selection};
use crate::dynamic_credentials::{Credential, Destination, RequestSelection, Source, SourceModel};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, future::Future, pin::Pin};

const MAX_MODELS: usize = 64;
const MAX_KEY_BYTES: usize = 64 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CatalogModel {
    pub id: String,
    pub label: String,
    pub selection: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Catalog {
    pub version: u8,
    pub agent: String,
    pub default_model: String,
    pub models: Vec<CatalogModel>,
}

/// A display label never participates in routing; the stable alias remains the ID.
pub(super) fn picker_label(package: &str, model: &str, native_label: Option<&str>) -> String {
    fn shortened(value: &str, limit: usize) -> String {
        let value = value.trim();
        if value.chars().count() <= limit {
            value.into()
        } else {
            value
                .chars()
                .take(limit - 1)
                .chain(std::iter::once('…'))
                .collect()
        }
    }
    let friendly = ["sonnet", "opus", "haiku", "fable"]
        .into_iter()
        .find_map(|family| {
            let version = model.strip_prefix(&format!("claude-{family}-"))?;
            let version = version.split("-20").next()?;
            if version.is_empty()
                || !version
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b"-.".contains(&b))
            {
                return None;
            }
            let mut name = family.to_owned();
            name[..1].make_ascii_uppercase();
            Some(format!("{name} {}", version.replace('-', ".")))
        });
    let model_label = native_label
        .filter(|label| !label.trim().is_empty())
        .or(friendly.as_deref())
        .unwrap_or(model);
    // Native menus and composer chips have fixed widths. Spend that space on
    // the model, whose trailing family name distinguishes e.g. Terra and Luna.
    // Keep the complete package name in ORG2's connection selector.
    let package = package.trim();
    let package_label = if package.chars().count() <= 10 {
        package.to_owned()
    } else {
        let initials: String = package
            .split(|c: char| !c.is_alphanumeric())
            .filter_map(|word| word.chars().next())
            .flat_map(char::to_uppercase)
            .collect();
        if (2..=6).contains(&initials.chars().count()) {
            initials
        } else {
            shortened(package, 7)
        }
    };
    format!("{package_label} · {}", shortened(model_label, 64))
}

pub(super) fn alias(selection: &Selection) -> Result<String, String> {
    let model = selection.model.as_deref().ok_or("Market model missing")?;
    // Session IDs deliberately do not change the native picker ID on reapply.
    let owner = serde_json::to_vec(&(
        &selection.metadata,
        &selection.workspace_id,
        &selection.entitlement_id,
    ))
    .map_err(|_| "Invalid Market identity")?;
    let digest = format!("{:x}", Sha256::digest(owner));
    let id = format!("{model}-org2-{}", &digest[..20]);
    if id.len() > 256 || id.chars().any(char::is_control) {
        return Err("Market model cannot be represented in this app".into());
    }
    Ok(id)
}

/// Desktop's gateway route-name validator does not accept GPT provider IDs.
/// Only the transport alias changes: labels, authorization and wire models stay
/// attached to the real selection. Keep existing Claude aliases stable.
pub(super) fn alias_for_agent(selection: &Selection, agent: &str) -> Result<String, String> {
    let model = selection.model.as_deref().ok_or("Market model missing")?;
    let legacy = alias(selection)?;
    if agent != "claude_desktop" || model.starts_with("claude-") {
        return Ok(legacy);
    }
    let owner = serde_json::to_vec(&(
        "org2-desktop-gateway-route-v1",
        &selection.metadata,
        &selection.workspace_id,
        &selection.entitlement_id,
        model,
    ))
    .map_err(|_| "Invalid Market identity")?;
    Ok(desktop_route_id(&Sha256::digest(owner)))
}

fn desktop_route_id(digest: &[u8]) -> String {
    // Decimal bytes preserve the existing 80-bit collision bound without
    // accidentally spelling provider names (e.g. "abab") in a hex suffix.
    let suffix: String = digest[..10]
        .iter()
        .map(|byte| format!("{byte:03}"))
        .collect();
    format!("claude-org2-route-{suffix}")
}

impl Catalog {
    pub fn key(&self) -> Result<String, String> {
        let key = format!(
            "market-app:{}",
            URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(self).map_err(|_| "Invalid Market app catalog")?)
        );
        Self::parse(&key, &self.agent)?;
        Ok(key)
    }
    pub fn parse(key: &str, agent: &str) -> Result<Self, String> {
        if key.len() > MAX_KEY_BYTES {
            return Err("Market app catalog is too large".into());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(
                key.strip_prefix("market-app:")
                    .ok_or("Invalid Market app catalog")?,
            )
            .map_err(|_| "Invalid Market app catalog")?;
        let catalog: Self =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Market app catalog")?;
        if catalog.version != 1
            || catalog.agent != agent
            || catalog.models.is_empty()
            || catalog.models.len() > MAX_MODELS
        {
            return Err("Market app catalog mismatch".into());
        }
        let mut ids = HashSet::new();
        let mut purchases = HashSet::new();
        let mut identity = None;
        for model in &catalog.models {
            let selection = Selection::parse(&model.selection, agent)?;
            // Read canonical legacy catalogs for restoration and existing helpers.
            if (model.id != alias_for_agent(&selection, agent)? && model.id != alias(&selection)?)
                || !ids.insert(&model.id)
                || model.label.trim().is_empty()
                || model.label.len() > 512
                || model.label.chars().any(char::is_control)
            {
                return Err("Invalid Market catalog model".into());
            }
            if identity
                .as_ref()
                .is_some_and(|id| id != &selection.metadata.identity_user_id)
            {
                return Err("Market app packages belong to different identities".into());
            }
            identity = Some(selection.metadata.identity_user_id.clone());
            purchases.insert((selection.workspace_id, selection.entitlement_id));
        }
        if purchases.len() > 8 || !ids.contains(&catalog.default_model) {
            return Err("Invalid Market app package selection".into());
        }
        Ok(catalog)
    }
    pub fn resolve(&self, model: &str) -> Result<RequestSelection, String> {
        let entry = self
            .models
            .iter()
            .find(|entry| entry.id == model)
            .ok_or("Model is not in the configured Market packages")?;
        let selection = Selection::parse(&entry.selection, &self.agent)?;
        Ok(RequestSelection {
            selection: entry.selection.clone(),
            model: selection.model.ok_or("Market model missing")?,
        })
    }
    pub async fn validate_live(&self) -> Result<(), String> {
        // Fetch each authorization once; a catalog is bounded to eight packages.
        let mut entries = std::collections::HashMap::new();
        for model in &self.models {
            let selection = Selection::parse(&model.selection, &self.agent)?;
            let owner = serde_json::to_string(&selection.metadata)
                .map_err(|_| "Invalid Market identity")?;
            if !entries.contains_key(&owner) {
                entries.insert(
                    owner.clone(),
                    source::options(selection.metadata.clone()).await?,
                );
            }
            source::validate_external_purchase(
                &entries[&owner],
                &selection.workspace_id,
                &selection.entitlement_id,
                &self.agent,
                selection.model.as_deref().ok_or("Market model missing")?,
                chrono::Utc::now().timestamp_millis(),
            )?;
        }
        Ok(())
    }
}

// This is an explicit default-package compatibility policy, not provenance
// proof: syntactically bare names can also arrive from non-history requests.
fn codex_bare_model_fallback(agent: &str, model: &str) -> bool {
    agent == "codex"
        && !model.contains("-org2-")
        && !model.starts_with("claude-org2-route-")
        && !model.is_empty()
        && model.len() <= 256
        && model
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'.' | b'_'))
}

pub(super) struct AppSource;
impl Source for AppSource {
    fn namespace(&self) -> &'static str {
        "market-app"
    }
    fn destination(&self, key: &str, agent: &str) -> Result<Destination, String> {
        let catalog = Catalog::parse(key, agent)?;
        source::instance().destination(&catalog.resolve(&catalog.default_model)?.selection, agent)
    }
    fn request_selection(
        &self,
        key: &str,
        agent: &str,
        model: &str,
    ) -> Result<Option<RequestSelection>, String> {
        let catalog = Catalog::parse(key, agent)?;
        match catalog.resolve(model) {
            Ok(route) => Ok(Some(route)),
            Err(_) if codex_bare_model_fallback(agent, model) => {
                catalog.resolve(&catalog.default_model).map(Some)
            }
            Err(error) => Err(error),
        }
    }
    fn models(&self, key: &str, agent: &str) -> Result<Option<Vec<SourceModel>>, String> {
        Ok(Some(
            Catalog::parse(key, agent)?
                .models
                .into_iter()
                .map(|model| SourceModel {
                    id: model.id,
                    label: model.label,
                })
                .collect(),
        ))
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>> {
        Box::pin(async move {
            let catalog = Catalog::parse(key, agent)?;
            let route = catalog.resolve(&catalog.default_model)?;
            source::instance().credential(&route.selection, agent).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn entry(purchase: &str, model: &str) -> CatalogModel {
        let selection = Selection {
            native_protocol: None,
            metadata: market_connect::ConnectionMetadata {
                identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                workspace_id: "ws_anchor".into(),
                target: market_connect::Target::Org2,
            },
            workspace_id: "ws_purchases".into(),
            entitlement_id: purchase.into(),
            model: Some(model.into()),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
        };
        CatalogModel {
            id: alias(&selection).unwrap(),
            label: format!("{purchase} · {model}"),
            selection: selection.key().unwrap(),
        }
    }
    fn catalog() -> Catalog {
        let models = vec![
            entry("pa_first", "gpt-shared"),
            entry("pa_second", "gpt-shared"),
            entry("pa_first", "gpt-other"),
        ];
        Catalog {
            version: 1,
            agent: "codex".into(),
            default_model: models[0].id.clone(),
            models,
        }
    }
    // Observed gateway route predicate in Claude Desktop's installed build
    // c38127e27202ddc1c8c187102f7798a93b1b8ede (2026-09-21). This fixture
    // verifies compatibility only; it is not a claim of native GPT support.
    fn desktop_accepts_gateway_route(model: &str) -> bool {
        let blocked = regex::Regex::new(
            r"ark-code|astron|command-r|deepseek|doubao|gemini|gemma|glm|gpt|grok|hermes|hy3|kimi|lfm|\bling\b|llama|longcat|mimo|minimax|mistral|mixtral|moonshot|nemotron|openai|phi-|qianfan|qwen|tc-code|\bunic\b|yi-|stepfun|step-3|seed-|bytedance|hunyuan|granite|amazon\.nova|nova-|devstral|ministral|ernie|codex|arcee|trinity|abab|phi\d|\bk2\.|\bm2\.|jamba|arctic|solar|mercury|zamba|kat-coder|\bds-|dpsk",
        ).unwrap();
        let model = model.to_lowercase();
        !blocked.is_match(&model)
            && [
                "claude",
                "sonnet",
                "opus",
                "haiku",
                "fable",
                "mythos",
                "anthropic",
            ]
            .iter()
            .any(|family| model.contains(family))
    }

    #[test]
    fn desktop_gateway_alias_preserves_real_model_purchase_and_legacy_catalogs() {
        let blocked_hex_digest = [0xab; 32];
        assert!(!desktop_accepts_gateway_route(
            "claude-org2-route-abababababababababab"
        ));
        assert!(desktop_accepts_gateway_route(&desktop_route_id(
            &blocked_hex_digest
        )));
        assert!(desktop_route_id(&blocked_hex_digest)
            .strip_prefix("claude-org2-route-")
            .unwrap()
            .bytes()
            .all(|b| b.is_ascii_digit()));
        let mut c = catalog();
        c.agent = "claude_desktop".into();
        // Legacy saved GPT catalogs remain decodable for Restore.
        assert!(Catalog::parse(&c.key().unwrap(), "claude_desktop").is_ok());
        for entry in &mut c.models {
            let selection = Selection::parse(&entry.selection, "claude_desktop").unwrap();
            let old = alias(&selection).unwrap();
            assert!(!desktop_accepts_gateway_route(&old));
            assert!(!desktop_accepts_gateway_route(&format!("claude-{old}")));
            entry.id = alias_for_agent(&selection, "claude_desktop").unwrap();
            assert!(desktop_accepts_gateway_route(&entry.id));
            assert!(entry.label.contains(selection.model.as_deref().unwrap()));
            let mut rotated = Selection::parse(&entry.selection, "claude_desktop").unwrap();
            rotated.session_id = Some(uuid::Uuid::new_v4().to_string());
            assert_eq!(
                entry.id,
                alias_for_agent(&rotated, "claude_desktop").unwrap()
            );
            assert_eq!(alias_for_agent(&selection, "codex").unwrap(), old);
        }
        c.default_model = c.models[0].id.clone();
        let key = c.key().unwrap();
        let parsed = Catalog::parse(&key, "claude_desktop").unwrap();
        assert_ne!(parsed.models[0].id, parsed.models[1].id);
        assert_ne!(parsed.models[0].id, parsed.models[2].id);
        for entry in &parsed.models {
            let route = AppSource
                .request_selection(&key, "claude_desktop", &entry.id)
                .unwrap()
                .unwrap();
            assert_eq!(route.selection, entry.selection);
            let selection = Selection::parse(&route.selection, "claude_desktop").unwrap();
            assert_eq!(Some(route.model.as_str()), selection.model.as_deref());
        }
        // An alias cannot be rebound to another authorized purchase.
        c.models[0].selection = c.models[1].selection.clone();
        assert!(c.key().is_err());
        let fable = entry("pa_first", "claude-fable-5-1");
        let selection = Selection::parse(&fable.selection, "claude_desktop").unwrap();
        assert_eq!(
            alias_for_agent(&selection, "claude_desktop").unwrap(),
            fable.id
        );
        assert!(desktop_accepts_gateway_route(&fable.id));
    }

    #[test]
    fn overlapping_models_route_to_the_selected_purchase_and_wire_model() {
        let catalog = catalog();
        let key = catalog.key().unwrap();
        let restored = Catalog::parse(&key, "codex").unwrap();
        for (index, purchase, model) in [
            (0, "pa_first", "gpt-shared"),
            (1, "pa_second", "gpt-shared"),
            (2, "pa_first", "gpt-other"),
        ] {
            let route = AppSource
                .request_selection(&key, "codex", &restored.models[index].id)
                .unwrap()
                .unwrap();
            let owner = Selection::parse(&route.selection, "codex").unwrap();
            assert_eq!(owner.entitlement_id, purchase);
            assert_eq!(owner.model.as_deref(), Some(model));
            assert_eq!(route.model, model);
        }
        assert_ne!(restored.models[0].id, restored.models[1].id);
        for requested in ["gpt-shared", "gpt-5.4"] {
            let route = AppSource
                .request_selection(&key, "codex", requested)
                .unwrap()
                .unwrap();
            assert_eq!(route.selection, restored.models[0].selection);
            assert_eq!(route.model, "gpt-shared");
        }
        let second = AppSource
            .request_selection(&key, "codex", &restored.models[1].id)
            .unwrap()
            .unwrap();
        assert_eq!(second.selection, restored.models[1].selection);
        let stale = entry("pa_retired", "gpt-shared");
        for rejected in [
            stale.id.as_str(),
            "gpt-shared-org2-00000000000000000000",
            "claude-org2-route-00000000000000000000000000000000",
            "",
            "gpt 5.4",
        ] {
            assert!(AppSource
                .request_selection(&key, "codex", rejected)
                .is_err());
        }
        assert!(Catalog::parse(&key, "claude_code").is_err());
    }

    #[test]
    fn claude_requests_keep_strict_alias_resolution() {
        for agent in ["claude_desktop", "claude_code"] {
            let mut c = catalog();
            c.agent = agent.into();
            for entry in &mut c.models {
                let selection = Selection::parse(&entry.selection, agent).unwrap();
                entry.id = alias_for_agent(&selection, agent).unwrap();
            }
            c.default_model = c.models[0].id.clone();
            let key = c.key().unwrap();
            for requested in ["gpt-shared", "claude-fable-5-1", "unknown"] {
                assert!(AppSource.request_selection(&key, agent, requested).is_err());
            }
            assert!(AppSource
                .request_selection(&key, agent, &c.models[1].id)
                .unwrap()
                .is_some());
        }
    }

    #[test]
    fn bare_model_compatibility_is_bounded_and_rejects_malformed_input() {
        let c = catalog();
        let key = c.key().unwrap();
        for rejected in [
            "x".repeat(257),
            "gpt\nmodel".into(),
            "模型".into(),
            "gpt/model".into(),
            "gpt=model".into(),
        ] {
            assert!(AppSource
                .request_selection(&key, "codex", &rejected)
                .is_err());
        }
        let route = AppSource
            .request_selection(&key, "codex", &"x".repeat(256))
            .unwrap()
            .unwrap();
        assert_eq!(route.selection, c.models[0].selection);
    }
    #[test]
    fn picker_labels_are_readable_bounded_and_do_not_change_routing() {
        assert_eq!(
            picker_label("Coding for beginner", "claude-sonnet-5", None),
            "CFB · Sonnet 5"
        );
        assert_eq!(
            picker_label("Overlap", "claude-fable-5-1", None),
            "Overlap · Fable 5.1"
        );
        assert_eq!(
            picker_label("Codex package", "gpt-5.6-luna", Some("GPT-5.6 Luna")),
            "CP · GPT-5.6 Luna"
        );
        assert_eq!(
            picker_label("Codex diagnostics", "gpt-5.6-luna", Some("GPT-5.6-Luna")),
            "CD · GPT-5.6-Luna"
        );
        assert_eq!(
            picker_label(
                "Coding for beginner",
                "gpt-5.6-terra",
                Some("GPT-5.6-Terra")
            ),
            "CFB · GPT-5.6-Terra"
        );
        assert_eq!(
            picker_label("Custom", "unknown-model", None),
            "Custom · unknown-model"
        );
        let long = picker_label(&"套餐😀".repeat(40), &"模😀".repeat(80), None);
        assert!(long.len() < 512);
        assert!(long.contains("… · "));
        assert!(long.ends_with('…'));
        // Existing v1 catalogs remain readable, and relabeling preserves the route.
        let mut c = catalog();
        let id = c.models[0].id.clone();
        let selection = c.models[0].selection.clone();
        c.models[0].label = picker_label("Renamed package", "gpt-shared", None);
        let parsed = Catalog::parse(&c.key().unwrap(), "codex").unwrap();
        assert_eq!(parsed.models[0].id, id);
        assert_eq!(parsed.models[0].selection, selection);
    }

    #[test]
    fn aliases_are_stable_across_sessions_and_do_not_contain_credentials() {
        assert_eq!(
            entry("pa_first", "gpt-shared").id,
            entry("pa_first", "gpt-shared").id
        );
        let key = catalog().key().unwrap();
        let bytes = URL_SAFE_NO_PAD
            .decode(key.strip_prefix("market-app:").unwrap())
            .unwrap();
        let json = String::from_utf8(bytes).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("token"));
    }
    #[test]
    fn catalog_rejects_tampering_duplicates_cross_identity_and_unbounded_inputs() {
        let mut c = catalog();
        c.models[1].id = c.models[0].id.clone();
        assert!(c.key().is_err());
        let mut c = catalog();
        c.default_model = "gpt-shared".into();
        assert!(c.key().is_err());
        let mut c = catalog();
        c.models[0].label = "bad\nlabel".into();
        assert!(c.key().is_err());
        let mut c = catalog();
        let mut selection = Selection::parse(&c.models[1].selection, "codex").unwrap();
        selection.metadata.identity_user_id = "22222222-2222-4222-8222-222222222222".into();
        c.models[1].id = alias(&selection).unwrap();
        c.models[1].selection = selection.key().unwrap();
        assert!(c.key().is_err());
        let mut c = catalog();
        for index in 0..65 {
            c.models.push(entry(&format!("pa_{index}"), "gpt-shared"));
        }
        assert!(c.key().is_err());
        assert!(Catalog::parse(&"x".repeat(MAX_KEY_BYTES + 1), "codex").is_err());
    }
    #[test]
    fn single_purchase_model_switch_updates_the_token_model_before_fetch() {
        let entry = entry("pa_first", "gpt-shared");
        let route = source::instance()
            .request_selection(&entry.selection, "codex", "gpt-other")
            .unwrap()
            .unwrap();
        let selection = Selection::parse(&route.selection, "codex").unwrap();
        assert_eq!(selection.entitlement_id, "pa_first");
        assert_eq!(selection.model.as_deref(), Some("gpt-other"));
        assert_eq!(route.model, "gpt-other");
        assert!(source::instance()
            .request_selection(&entry.selection, "codex", "bad\nmodel")
            .is_err());
    }
}

#[cfg(test)]
#[path = "app_catalog_proxy_tests.rs"]
mod proxy_tests;
