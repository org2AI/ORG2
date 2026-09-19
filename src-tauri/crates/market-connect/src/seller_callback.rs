//! Local seller callback transport. Provider tokens and exchange stay on Market.
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use url::Url;

#[derive(Clone, Copy)]
pub enum SellerProvider {
    Claude,
    Codex,
}
impl SellerProvider {
    fn destination(self) -> (&'static str, u16, &'static str) {
        match self {
            Self::Claude => ("https://claude.ai", 54545, "/callback"),
            Self::Codex => ("https://auth.openai.com", 1455, "/auth/callback"),
        }
    }
}

// Intentionally neither Debug nor Serialize: URL/state/code never leave native
// transport except to the fixed provider browser and authenticated Market API.
pub struct SellerAuthorization {
    provider: SellerProvider,
    url: Url,
    state: String,
    timeout: Duration,
}
impl SellerAuthorization {
    pub fn parse(
        provider: SellerProvider,
        raw: &str,
        expires_at: &str,
    ) -> Result<Self, &'static str> {
        let (origin, port, path) = provider.destination();
        let url = Url::parse(raw).map_err(|_| "invalid_seller_authorization")?;
        let one = |name: &str| -> Option<String> {
            let mut values = url
                .query_pairs()
                .filter(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned());
            let first = values.next()?;
            if values.next().is_some() {
                None
            } else {
                Some(first)
            }
        };
        let state = one("state")
            .filter(|s| !s.is_empty() && s.len() <= 512)
            .ok_or("invalid_seller_authorization")?;
        let deadline = chrono::DateTime::parse_from_rfc3339(expires_at)
            .map_err(|_| "invalid_seller_authorization")?;
        let remaining = (deadline.with_timezone(&chrono::Utc) - chrono::Utc::now())
            .to_std()
            .map_err(|_| "seller_authorization_expired")?;
        if raw.len() > 8192
            || url.origin().ascii_serialization() != origin
            || url.path() != "/oauth/authorize"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || one("redirect_uri").as_deref()
                != Some(format!("http://localhost:{port}{path}").as_str())
            || one("response_type").as_deref() != Some("code")
            || one("code_challenge_method").as_deref() != Some("S256")
            || !one("code_challenge").is_some_and(|s| {
                s.len() == 43
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            })
            || remaining.is_zero()
        {
            return Err("invalid_seller_authorization");
        }
        Ok(Self {
            provider,
            url,
            state,
            timeout: remaining.min(Duration::from_secs(300)),
        })
    }
    pub fn browser_url(&self) -> &str {
        self.url.as_str()
    }
    pub async fn listen(self) -> Result<SellerCallback, &'static str> {
        let port = self.provider.destination().1;
        self.bind(port).await
    }
    async fn bind(self, port: u16) -> Result<SellerCallback, &'static str> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|_| "seller_callback_unavailable")?;
        let port = listener
            .local_addr()
            .map_err(|_| "seller_callback_unavailable")?
            .port();
        let (sender, receiver) = oneshot::channel();
        let (stop, stopped) = oneshot::channel();
        let state = Arc::new(CallbackState {
            provider: self.provider,
            state: self.state,
            port,
            sender: Mutex::new(Some(sender)),
        });
        let app = Router::new()
            .route(self.provider.destination().2, get(callback))
            .with_state(state);
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
        });
        Ok(SellerCallback {
            receiver: Some(receiver),
            task,
            stop: Some(stop),
            timeout: self.timeout,
            port,
        })
    }
}
struct CallbackState {
    provider: SellerProvider,
    state: String,
    port: u16,
    sender: Mutex<Option<oneshot::Sender<Result<String, &'static str>>>>,
}
async fn callback(
    State(state): State<Arc<CallbackState>>,
    request: Request<Body>,
) -> impl IntoResponse {
    let response = |status, text| {
        (
            status,
            [
                ("cache-control", "no-store"),
                ("referrer-policy", "no-referrer"),
                (
                    "content-security-policy",
                    "default-src 'none'; frame-ancestors 'none'",
                ),
                ("content-type", "text/plain; charset=utf-8"),
            ],
            text,
        )
    };
    if request.method() != axum::http::Method::GET {
        return response(StatusCode::METHOD_NOT_ALLOWED, "GET required.");
    }
    let host = request
        .headers()
        .get("host")
        .and_then(|s| s.to_str().ok())
        .unwrap_or("");
    let local = format!("localhost:{}", state.port);
    let ip = format!("127.0.0.1:{}", state.port);
    let raw = request.uri().to_string();
    let origin = request.headers().get("origin");
    if (host != local && host != ip)
        || raw.len() > 4096
        || !raw.starts_with('/')
        || raw.starts_with("//")
        || origin.is_some_and(|v| {
            v.to_str().ok() != Some(state.provider.destination().0)
                && v.to_str().ok() != Some(format!("http://{local}").as_str())
        })
    {
        return response(StatusCode::BAD_REQUEST, "Invalid authorization callback.");
    }
    let Ok(url) = Url::parse(&format!("http://{local}{raw}")) else {
        return response(StatusCode::BAD_REQUEST, "Invalid authorization callback.");
    };
    let values = |name: &str| {
        url.query_pairs()
            .filter(|(key, _)| key == name)
            .map(|(_, v)| v.into_owned())
            .collect::<Vec<_>>()
    };
    if values("state") != [state.state.clone()] || url.path() != state.provider.destination().2 {
        return response(StatusCode::BAD_REQUEST, "Authorization does not match.");
    }
    let codes = values("code");
    let errors = values("error");
    let result = if errors.len() == 1 && codes.is_empty() {
        Err("seller_authorization_denied")
    } else if errors.is_empty()
        && codes.len() == 1
        && !codes[0].is_empty()
        && codes[0].len() <= 2048
    {
        let (_, port, path) = state.provider.destination();
        let mut redirect = Url::parse(&format!("http://localhost:{port}{path}"))
            .map_err(|_| "invalid_seller_callback");
        if let Ok(redirect) = &mut redirect {
            redirect
                .query_pairs_mut()
                .append_pair("state", &state.state)
                .append_pair("code", &codes[0]);
        }
        redirect.map(|url| url.to_string())
    } else {
        return response(StatusCode::BAD_REQUEST, "Invalid authorization callback.");
    };
    let Ok(mut slot) = state.sender.lock() else {
        return response(StatusCode::CONFLICT, "Authorization already received.");
    };
    let Some(sender) = slot.take() else {
        return response(StatusCode::CONFLICT, "Authorization already received.");
    };
    let _ = sender.send(result);
    response(
        StatusCode::OK,
        "Authorization received. Return to ORG2 to finish connecting.",
    )
}

pub struct SellerCallback {
    receiver: Option<oneshot::Receiver<Result<String, &'static str>>>,
    task: JoinHandle<()>,
    stop: Option<oneshot::Sender<()>>,
    timeout: Duration,
    port: u16,
}
impl SellerCallback {
    /// Await one matching callback. Dropping the receiver cancels and frees its port.
    pub async fn receive(mut self) -> Result<String, &'static str> {
        let receiver = self.receiver.take().ok_or("seller_callback_unavailable")?;
        let result = match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => Err("seller_callback_unavailable"),
            Err(_) => Err("seller_authorization_expired"),
        };
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), &mut self.task).await;
        result
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}
impl Drop for SellerCallback {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn auth() -> SellerAuthorization {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut url = Url::parse("https://claude.ai/oauth/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("state", "test-state"),
            ("redirect_uri", "http://localhost:54545/callback"),
            ("response_type", "code"),
            ("code_challenge_method", "S256"),
            ("code_challenge", &"a".repeat(43)),
        ]);
        SellerAuthorization::parse(
            SellerProvider::Claude,
            url.as_str(),
            &(chrono::Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn invalid_callback_cannot_consume_matching_authorization() {
        let listener = auth().bind(0).await.unwrap();
        let base = format!("http://127.0.0.1:{}/callback", listener.port());
        let client = reqwest::Client::new();
        for query in [
            "state=wrong&code=secret",
            "state=test-state&state=test-state&code=secret",
            "state=test-state&code=a&code=b",
        ] {
            assert_eq!(
                client
                    .get(format!("{base}?{query}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                400
            );
        }
        assert_eq!(
            client
                .get(format!("{base}?state=test-state&code=secret"))
                .header("host", "attacker.invalid")
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        assert_eq!(
            client
                .head(format!("{base}?state=test-state&code=secret"))
                .send()
                .await
                .unwrap()
                .status(),
            405
        );
        let response = client
            .get(format!(
                "{base}?state=test-state&code=secret&injected=ignored"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(!response.text().await.unwrap().contains("secret"));
        assert_eq!(
            client
                .get(format!("{base}?state=test-state&code=secret"))
                .send()
                .await
                .unwrap()
                .status(),
            409
        );
        assert_eq!(
            listener.receive().await.unwrap(),
            "http://localhost:54545/callback?state=test-state&code=secret"
        );
    }
    #[tokio::test]
    async fn denial_and_timeout_release_the_listener() {
        let listener = auth().bind(0).await.unwrap();
        let port = listener.port();
        reqwest::get(format!(
            "http://127.0.0.1:{port}/callback?state=test-state&error=access_denied"
        ))
        .await
        .unwrap();
        assert_eq!(
            listener.receive().await.unwrap_err(),
            "seller_authorization_denied"
        );
        let mut authorization = auth();
        authorization.timeout = Duration::from_millis(10);
        let listener = authorization.bind(port).await.unwrap();
        assert_eq!(
            listener.receive().await.unwrap_err(),
            "seller_authorization_expired"
        );
        assert!(auth().bind(port).await.is_ok());
    }
    #[tokio::test]
    async fn cancellation_frees_port_without_waiting_for_provider() {
        let listener = auth().bind(0).await.unwrap();
        let port = listener.port();
        assert!(auth().bind(port).await.is_err());
        let waiting = tokio::spawn(listener.receive());
        waiting.abort();
        let _ = waiting.await;
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if auth().bind(port).await.is_ok() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
    #[test]
    fn rejects_substituted_provider_destination() {
        let a = auth();
        let deadline = (chrono::Utc::now() + chrono::Duration::minutes(1)).to_rfc3339();
        assert!(
            SellerAuthorization::parse(SellerProvider::Codex, a.browser_url(), &deadline).is_err()
        );
        assert!(SellerAuthorization::parse(
            SellerProvider::Claude,
            &a.browser_url().replace("claude.ai", "attacker.invalid"),
            &deadline
        )
        .is_err());
    }
}
