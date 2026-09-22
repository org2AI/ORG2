//! Application-supplied credential ownership for native providers. The core
//! never imports a marketplace or stores a short-lived credential.
use super::traits::{LLMProvider, ProviderError};
use std::sync::{Arc, OnceLock, RwLock};

pub trait NativeProviderSource: Send + Sync {
    fn namespace(&self) -> &'static str;
    fn build(&self, selection: &str, model: &str) -> Result<Box<dyn LLMProvider>, ProviderError>;
}
static SOURCES: OnceLock<RwLock<Vec<Arc<dyn NativeProviderSource>>>> = OnceLock::new();
pub fn register(source: Arc<dyn NativeProviderSource>) -> Result<(), String> {
    let mut sources = SOURCES
        .get_or_init(Default::default)
        .write()
        .map_err(|_| "Native credential registry unavailable")?;
    if sources.len() >= 8 || sources.iter().any(|s| s.namespace() == source.namespace()) {
        return Err("Duplicate native credential source".into());
    }
    sources.push(source);
    Ok(())
}
pub fn build(selection: &str, model: &str) -> Result<Box<dyn LLMProvider>, ProviderError> {
    let (namespace, _) = selection
        .split_once(':')
        .ok_or_else(|| ProviderError::AuthError("Invalid native credential selection".into()))?;
    if selection.len() > 1024 || model.trim().is_empty() {
        return Err(ProviderError::AuthError(
            "Invalid native credential selection".into(),
        ));
    }
    let source = SOURCES
        .get_or_init(Default::default)
        .read()
        .map_err(|_| ProviderError::AuthError("Native credential registry unavailable".into()))?
        .iter()
        .find(|s| s.namespace() == namespace)
        .cloned()
        .ok_or_else(|| {
            ProviderError::AuthError("Selected native credential module is unavailable".into())
        })?;
    source.build(selection, model)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_module_and_invalid_selector_fail_closed() {
        for selection in ["missing-test-source:public-selector", "no-namespace", ""] {
            assert!(matches!(
                build(selection, "model"),
                Err(ProviderError::AuthError(_))
            ));
        }
        assert!(build(&format!("market:{}", "x".repeat(1024)), "model").is_err());
        assert!(build("market:selection", " ").is_err());
    }
    #[tokio::test]
    async fn source_never_accepts_account_or_native_harness_fallback() {
        let reliability = crate::config::ReliabilityConfig::default();
        let result = super::super::factory::create_provider_with_selection_preflight(
            "model",
            Some("ordinary-key"),
            Some("market:selection"),
            &reliability,
            None,
            None,
        )
        .await;
        assert!(matches!(result, Err(ProviderError::AuthError(_))));
        let result = super::super::factory::create_provider_with_selection_preflight(
            "model",
            None,
            Some("market:selection"),
            &reliability,
            Some(core_types::providers::NativeHarnessType::CursorNative),
            None,
        )
        .await;
        assert!(matches!(result, Err(ProviderError::AuthError(_))));
    }
}
