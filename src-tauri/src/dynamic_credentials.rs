//! Generic native credential sources for managed clients. Registration belongs
//! to application composition; providers may rotate secrets without config edits.
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, OnceLock, RwLock},
};

/// Authentication is declared by the source, independent of its namespace.
#[derive(Debug, Clone, Copy)]
pub enum Authentication {
    ProtocolDefault,
    #[cfg_attr(not(feature = "market-connect"), allow(dead_code))]
    Bearer,
}

#[derive(Clone)]
pub struct Destination {
    pub authentication: Authentication,
    pub provider: String,
    pub base_url: String,
}
pub struct Credential {
    pub destination: Destination,
    pub secret: String,
}
pub struct RequestSelection {
    pub selection: String,
    pub model: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SourceModel {
    pub id: String,
    pub label: String,
}

/// Keeps a dynamic provider's authorization valid through a config commit.
/// The source owns identity policy; generic client adapters only enforce it.
#[cfg(feature = "market-connect")]
pub(crate) trait OperationAuthorization: Send {
    fn check(&self) -> Result<(), String>;
}

pub trait Source: Send + Sync {
    fn namespace(&self) -> &'static str;
    fn destination(&self, selection: &str, agent: &str) -> Result<Destination, String>;
    /// Resolve model and credential ownership together before minting a token.
    fn request_selection(
        &self,
        _selection: &str,
        _agent: &str,
        _model: &str,
    ) -> Result<Option<RequestSelection>, String> {
        Ok(None)
    }
    fn models(&self, _selection: &str, _agent: &str) -> Result<Option<Vec<SourceModel>>, String> {
        Ok(None)
    }
    fn credential<'a>(
        &'a self,
        selection: &'a str,
        agent: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>>;
}
static SOURCES: OnceLock<RwLock<Vec<Arc<dyn Source>>>> = OnceLock::new();
#[cfg(feature = "market-connect")]
pub fn register(source: Arc<dyn Source>) -> Result<(), String> {
    let namespace = source.namespace();
    if namespace.is_empty()
        || !namespace
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c == b'-')
    {
        return Err("Invalid credential namespace".into());
    }
    let mut sources = SOURCES
        .get_or_init(Default::default)
        .write()
        .map_err(|_| "Credential sources unavailable")?;
    if sources.len() >= 8 || sources.iter().any(|s| s.namespace() == namespace) {
        return Err("Duplicate or excessive credential sources".into());
    }
    sources.push(source);
    Ok(())
}
pub fn source(selection: &str) -> Result<Option<Arc<dyn Source>>, String> {
    // Static KeyVault IDs have no source prefix. Unknown prefixed selections
    // fail closed, including selections left by a disabled optional module.
    let Some((namespace, _)) = selection.split_once(':') else {
        return Ok(None);
    };
    let sources = SOURCES
        .get_or_init(Default::default)
        .read()
        .map_err(|_| "Credential sources unavailable")?;
    sources
        .iter()
        .find(|s| s.namespace() == namespace)
        .cloned()
        .map(Some)
        .ok_or_else(|| "Selected credential module is unavailable".into())
}

/// Startup recovery asks only whether a registered module owns the selection.
/// A broken registry is an error, not permission to restore configuration.
pub(crate) fn is_unavailable(selection: Option<&str>) -> Result<bool, String> {
    let Some((namespace, _)) = selection.and_then(|key| key.split_once(':')) else {
        return Ok(false);
    };
    let sources = SOURCES
        .get_or_init(Default::default)
        .read()
        .map_err(|_| "Credential sources unavailable")?;
    Ok(!sources.iter().any(|source| source.namespace() == namespace))
}

#[cfg(test)]
mod startup_recovery_tests {
    use super::*;

    struct Available;
    impl Source for Available {
        fn namespace(&self) -> &'static str {
            "startup-recovery-test"
        }
        fn destination(&self, _: &str, _: &str) -> Result<Destination, String> {
            Err("not used by startup recovery".into())
        }
        fn credential<'a>(
            &'a self,
            _: &'a str,
            _: &'a str,
        ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>> {
            Box::pin(async { Err("not used by startup recovery".into()) })
        }
    }

    #[test]
    fn recovery_uses_registered_ownership_and_preserves_static_keys() {
        assert!(!is_unavailable(None).unwrap());
        assert!(!is_unavailable(Some("static-key-id")).unwrap());
        assert!(is_unavailable(Some("removed-test-module:selection")).unwrap());
        register(Arc::new(Available)).unwrap();
        assert!(!is_unavailable(Some("startup-recovery-test:selection")).unwrap());
        assert!(source("removed-test-module:selection").is_err());
    }
}
