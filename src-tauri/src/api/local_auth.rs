//! Request authentication for the loopback IDE server.
//!
//! The loopback bind keeps other machines out, but not other *origins*: any
//! page a browser loads can address `localhost`. Every protected route
//! therefore requires
//!
//! 1. a loopback `Host`, so a hostname rebound to `127.0.0.1` is refused;
//! 2. an `Origin` that is one of this app's own webviews, whenever the client
//!    sends one; and
//! 3. a per-launch token that only the app's webviews can obtain, through the
//!    [`ide_server_token`] IPC command.
//!
//! Routes that carry their own credentials (`/hooks/*` and the sync webhook)
//! are mounted outside this layer; see `server::start_server`.
//!
//! Debug builds make one allowance, for the e2e harnesses that drive the
//! debug-only `/agent/*` test routes from outside the webview: see
//! [`is_debug_tooling_request`]. The token never touches the disk.

use std::sync::OnceLock;

use axum::extract::{Query, Request};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Header carrying the per-launch token.
pub const TOKEN_HEADER: &str = "x-orgii-token";
/// Query parameter carrying the token for `GET` requests issued by clients
/// that cannot set headers (`EventSource`, browser `WebSocket`).
pub const TOKEN_QUERY_PARAM: &str = "orgii_token";

static TOKEN: OnceLock<String> = OnceLock::new();

/// The token for this process. Generated on first use and stable until exit.
pub fn token() -> &'static str {
    TOKEN.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

/// Hand the token to the app's own webview. IPC is only available to the
/// windows listed in `capabilities/`, never to remote content.
#[tauri::command]
pub fn ide_server_token() -> String {
    token().to_string()
}

/// Timing-safe comparison, so the token cannot be recovered byte by byte from
/// response latency.
pub(crate) fn constant_time_eq(expected: &[u8], candidate: &[u8]) -> bool {
    if expected.len() != candidate.len() {
        return false;
    }
    expected
        .iter()
        .zip(candidate)
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rejection {
    Host,
    Origin,
    Token,
}

impl Rejection {
    fn status(self) -> StatusCode {
        match self {
            // The request did not come from this machine's own app at all.
            Rejection::Host | Rejection::Origin => StatusCode::FORBIDDEN,
            Rejection::Token => StatusCode::UNAUTHORIZED,
        }
    }
}

/// `Host` must name this machine's loopback interface. A page served from a
/// hostname that was rebound to `127.0.0.1` still sends its own hostname here.
fn is_loopback_host(host: &str) -> bool {
    let name = match host.strip_prefix('[') {
        // Bracketed IPv6 literal, with or without a port.
        Some(rest) => match rest.split_once(']') {
            Some((name, _port)) => name,
            None => return false,
        },
        None => host.rsplit_once(':').map_or(host, |(name, _port)| name),
    };
    matches!(name, "localhost" | "127.0.0.1" | "::1")
}

/// Origins this app's own webviews load from. Shared by the CORS layer and
/// the request check so the two can never disagree.
pub(crate) fn is_allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    // Packaged builds: `tauri://localhost` on macOS / Linux, and
    // `http(s)://tauri.localhost` on Windows.
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }
    // Debug builds load the frontend from a local dev server on any port.
    cfg!(debug_assertions) && is_loopback_http_origin(origin)
}

fn is_loopback_http_origin(origin: &str) -> bool {
    origin
        .strip_prefix("http://")
        .is_some_and(|authority| !authority.contains('/') && is_loopback_host(authority))
}

#[derive(serde::Deserialize)]
struct TokenQuery {
    #[serde(default)]
    orgii_token: Option<String>,
}

fn presented_token(method: &Method, uri: &Uri, headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(TOKEN_HEADER) {
        return value.to_str().ok().map(str::to_owned);
    }
    // Only `GET` may carry the token in the URL: that is what `EventSource`
    // and `WebSocket` issue, and it keeps the token out of every other URL.
    if method != Method::GET {
        return None;
    }
    Query::<TokenQuery>::try_from_uri(uri)
        .ok()
        .and_then(|Query(query)| query.orgii_token)
}

/// Debug builds only: a local process that is not a browser may reach the
/// `/agent/*` routes without the token. The e2e runner, the WDIO drivers and
/// the gateway CLI call the debug-only `/agent/test/*` routes from Node and
/// Rust, where they cannot obtain the token over IPC.
///
/// A browser cannot pass for one: it sends `Sec-Fetch-Site` on every request it
/// makes (including header-less `<img>` and `<script>` loads, which omit
/// `Origin`), and neither Node's `fetch` nor `reqwest` sends that header.
fn is_debug_tooling_request(uri: &Uri, headers: &HeaderMap) -> bool {
    cfg!(debug_assertions)
        && uri.path().starts_with("/agent/")
        && !headers.contains_key(header::ORIGIN)
        && !headers.contains_key("sec-fetch-site")
}

pub(crate) fn authorize(method: &Method, uri: &Uri, headers: &HeaderMap) -> Result<(), Rejection> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or(Rejection::Host)?;
    if !is_loopback_host(host) {
        return Err(Rejection::Host);
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !is_allowed_origin(origin) {
            return Err(Rejection::Origin);
        }
    }
    let token_ok = presented_token(method, uri, headers)
        .is_some_and(|presented| constant_time_eq(token().as_bytes(), presented.as_bytes()));
    if token_ok || is_debug_tooling_request(uri, headers) {
        return Ok(());
    }
    Err(Rejection::Token)
}

/// Axum middleware guarding every protected route.
pub async fn require_local_client(request: Request, next: Next) -> Response {
    match authorize(request.method(), request.uri(), request.headers()) {
        Ok(()) => next.run(request).await,
        Err(rejection) => {
            // Never log the URI: a `GET` may carry the token in its query.
            tracing::warn!(
                ?rejection,
                path = request.uri().path(),
                origin = ?request.headers().get(header::ORIGIN),
                "[IdeServer] Rejected request"
            );
            rejection.status().into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_str(value).expect("header value"));
        }
        map
    }

    fn check(method: Method, uri: &str, pairs: &[(&'static str, &str)]) -> Result<(), Rejection> {
        authorize(&method, &uri.parse().expect("uri"), &headers(pairs))
    }

    #[test]
    fn accepts_the_app_webview_with_the_token() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            assert_eq!(
                check(
                    Method::POST,
                    "/git/api/git/repo/x/checkout",
                    &[
                        ("host", "localhost:13847"),
                        ("origin", origin),
                        (TOKEN_HEADER, token()),
                    ],
                ),
                Ok(()),
                "{origin}"
            );
        }
    }

    /// A local non-browser client sends no `Origin`; the token still decides.
    #[test]
    fn a_client_without_an_origin_still_needs_the_token() {
        let uri = "/git/api/git/repo/x/status";
        assert_eq!(
            check(
                Method::GET,
                uri,
                &[("host", "127.0.0.1:13847"), (TOKEN_HEADER, token())],
            ),
            Ok(())
        );
        assert_eq!(
            check(Method::GET, uri, &[("host", "127.0.0.1:13847")]),
            Err(Rejection::Token)
        );
    }

    /// The e2e harnesses call `/agent/*` from Node and Rust without the token.
    /// That works in debug builds only, and never for a browser.
    #[test]
    fn debug_tooling_allowance_is_narrow() {
        let host = ("host", "127.0.0.1:13847");
        let tooling = check(Method::POST, "/agent/test/message", &[host]);
        if cfg!(debug_assertions) {
            assert_eq!(tooling, Ok(()));
        } else {
            assert_eq!(tooling, Err(Rejection::Token));
        }

        // Only `/agent/*`.
        assert_eq!(
            check(Method::POST, "/git/api/git/repo/x/checkout", &[host]),
            Err(Rejection::Token)
        );
        assert_eq!(
            check(Method::GET, "/agentx/test", &[host]),
            Err(Rejection::Token)
        );
        // Never a browser: a header-less `<img>` load omits `Origin` but still
        // sends `Sec-Fetch-Site`.
        assert_eq!(
            check(
                Method::GET,
                "/agent/test/effective-tools/x",
                &[host, ("sec-fetch-site", "cross-site")],
            ),
            Err(Rejection::Token)
        );
        // Never a rebound hostname.
        assert_eq!(
            check(
                Method::POST,
                "/agent/test/message",
                &[("host", "evil.example")]
            ),
            Err(Rejection::Host)
        );
    }

    #[test]
    fn rejects_a_missing_or_wrong_token() {
        let base = [("host", "localhost:13847"), ("origin", "tauri://localhost")];
        assert_eq!(check(Method::POST, "/x", &base), Err(Rejection::Token));

        let mut flipped = token().to_string().into_bytes();
        flipped[0] ^= 1;
        let flipped = String::from_utf8(flipped).expect("ascii token");
        assert_eq!(
            check(
                Method::POST,
                "/x",
                &[
                    ("host", "localhost:13847"),
                    ("origin", "tauri://localhost"),
                    (TOKEN_HEADER, &flipped),
                ],
            ),
            Err(Rejection::Token)
        );
    }

    /// The token does not excuse a foreign page: a leaked token must not be
    /// usable from another origin.
    #[test]
    fn rejects_a_foreign_origin_even_with_the_token() {
        for origin in [
            "https://example.com",
            "null",
            "tauri://evil",
            "http://tauri.localhost.evil",
        ] {
            assert_eq!(
                check(
                    Method::POST,
                    "/x",
                    &[
                        ("host", "localhost:13847"),
                        ("origin", origin),
                        (TOKEN_HEADER, token()),
                    ],
                ),
                Err(Rejection::Origin),
                "{origin}"
            );
        }
    }

    /// DNS rebinding: the attacker's hostname resolves to 127.0.0.1, but the
    /// browser still sends that hostname as `Host`.
    #[test]
    fn rejects_a_non_loopback_host() {
        for host in [
            "evil.example:13847",
            "localhost.evil.example",
            "10.0.0.5:13847",
            "[::2]:13847",
        ] {
            assert_eq!(
                check(
                    Method::GET,
                    "/x",
                    &[("host", host), (TOKEN_HEADER, token())]
                ),
                Err(Rejection::Host),
                "{host}"
            );
        }
        assert_eq!(
            check(Method::GET, "/x", &[(TOKEN_HEADER, token())]),
            Err(Rejection::Host)
        );
        for host in [
            "localhost",
            "localhost:1",
            "127.0.0.1:13847",
            "[::1]:13847",
            "[::1]",
        ] {
            assert!(is_loopback_host(host), "{host}");
        }
    }

    /// `EventSource` and `WebSocket` cannot set headers, so `GET` accepts the
    /// token as a query parameter. Nothing else does.
    #[test]
    fn query_token_is_accepted_for_get_only() {
        let uri = format!("/ws?{TOKEN_QUERY_PARAM}={}&path=%2Frepo", token());
        let base = [("host", "localhost:13847")];
        assert_eq!(check(Method::GET, &uri, &base), Ok(()));
        assert_eq!(check(Method::POST, &uri, &base), Err(Rejection::Token));
        assert_eq!(check(Method::DELETE, &uri, &base), Err(Rejection::Token));
    }

    #[test]
    fn dev_server_origins_follow_the_build_profile() {
        let dev = HeaderValue::from_static("http://localhost:1998");
        assert_eq!(is_allowed_origin(&dev), cfg!(debug_assertions));
        // Never a loopback origin with a path or another scheme.
        assert!(!is_loopback_http_origin("https://localhost:1998"));
        assert!(!is_loopback_http_origin("http://localhost:1998/x"));
        assert!(!is_loopback_http_origin("http://localhost.evil.example"));
    }

    #[test]
    fn rejections_map_to_status_codes() {
        assert_eq!(Rejection::Token.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(Rejection::Host.status(), StatusCode::FORBIDDEN);
        assert_eq!(Rejection::Origin.status(), StatusCode::FORBIDDEN);
    }
}
