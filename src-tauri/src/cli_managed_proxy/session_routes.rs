//! Process-owned routing for live client sessions. Tokens never select the
//! mutable global client configuration and are discarded on terminal release.
use super::ProxyContext;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

const PREFIX: &str = "session_";
const LIMIT: usize = 256;
struct Route {
    session: String,
    agent: String,
    context: ProxyContext,
}
#[derive(Default)]
struct Routes {
    entries: HashMap<String, Route>,
}
impl Routes {
    fn insert(
        &mut self,
        session: &str,
        agent: &str,
        mut context: ProxyContext,
    ) -> Result<String, String> {
        if self.entries.len() >= LIMIT {
            return Err("Too many live client sessions".into());
        }
        if self.entries.values().any(|route| route.session == session) {
            return Err("Client session already has a live route".into());
        }
        let token = format!("{PREFIX}{}", uuid::Uuid::new_v4().simple());
        context.proxy_token = token.clone();
        self.entries.insert(
            token.clone(),
            Route {
                session: session.into(),
                agent: agent.into(),
                context,
            },
        );
        Ok(token)
    }
    fn resolve(&self, agent: &str, token: &str) -> Result<Option<ProxyContext>, String> {
        if !token.starts_with(PREFIX) {
            return Ok(None);
        }
        self.entries
            .get(token)
            .filter(|route| route.agent == agent)
            .map(|route| Some(route.context.clone()))
            .ok_or_else(|| "Client session route is unavailable".into())
    }
    fn release(&mut self, session: &str) -> Vec<Route> {
        let tokens: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, route)| route.session == session)
            .map(|(token, _)| token.clone())
            .collect();
        tokens
            .into_iter()
            .filter_map(|token| self.entries.remove(&token))
            .collect()
    }
}
static ROUTES: OnceLock<Mutex<Routes>> = OnceLock::new();
fn routes() -> Result<std::sync::MutexGuard<'static, Routes>, String> {
    ROUTES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Client session routes unavailable".into())
}
pub(super) fn reserve(session: &str, agent: &str, context: ProxyContext) -> Result<String, String> {
    routes()?.insert(session, agent, context)
}
pub(super) fn resolve(agent: &str, token: &str) -> Result<Option<ProxyContext>, String> {
    routes()?.resolve(agent, token)
}
pub(super) fn release_token(token: &str) -> Result<bool, String> {
    let removed = routes()?.entries.remove(token);
    // File guards drop after the registry lock is released.
    Ok(removed.is_some())
}
pub(super) fn release(session: &str) -> Result<(), String> {
    let removed = routes()?.release(session);
    drop(removed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> ProxyContext {
        ProxyContext {
            authentication: crate::dynamic_credentials::Authentication::Bearer,
            key_id: "test-key".into(),
            provider: "test".into(),
            model: "model".into(),
            upstream_base_url: "https://example.invalid/v1".into(),
            api_key: String::new(),
            proxy_token: String::new(),
            protocol: super::super::ProxyProtocol::OpenAi,
        }
    }
    #[test]
    fn routes_are_scoped_bounded_and_released_without_fallback() {
        let mut routes = Routes::default();
        let first = routes.insert("one", "codex", context()).unwrap();
        let second = routes.insert("two", "codex", context()).unwrap();
        assert_ne!(first, second);
        assert!(routes.insert("one", "claude_code", context()).is_err());
        assert!(routes.resolve("claude_code", &first).is_err());
        assert!(routes.resolve("codex", "session_unknown").is_err());
        assert!(routes.resolve("codex", "global-token").unwrap().is_none());
        routes.release("one");
        routes.release("one");
        assert!(routes.resolve("codex", &first).is_err());
        assert!(routes.resolve("codex", &second).unwrap().is_some());
        for n in 1..LIMIT {
            routes
                .insert(&format!("slot-{n}"), "codex", context())
                .unwrap();
        }
        assert!(routes.insert("overflow", "codex", context()).is_err());
        routes.release("two");
        assert!(routes.insert("replacement", "codex", context()).is_ok());
    }
}
