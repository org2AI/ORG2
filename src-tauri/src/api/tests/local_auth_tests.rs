//! The request check wired into the real router, over a real socket: layer
//! order (CORS answers preflights before the check), which routes sit behind
//! the check, and which authenticate themselves.

use tokio::sync::broadcast;

use crate::api::local_auth::{token, TOKEN_HEADER, TOKEN_QUERY_PARAM};

const APP_ORIGIN: &str = "tauri://localhost";
/// A protected `GET` route that needs no state or repository to answer.
const PROTECTED_ROUTE: &str = "/api-docs/openapi.json";

/// Serve the full IDE router on an ephemeral loopback port.
async fn serve() -> String {
    let (ws_tx, _) = broadcast::channel::<String>(4);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        axum::serve(listener, crate::api::server::build_app(ws_tx))
            .await
            .expect("serve");
    });
    format!("http://{addr}")
}

fn client() -> reqwest::Client {
    crate::test_utils::install_crypto_provider_for_tests();
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("http client")
}

#[tokio::test]
async fn protected_routes_require_the_token() {
    let base = serve().await;
    let url = format!("{base}{PROTECTED_ROUTE}");

    let anonymous = client().get(&url).send().await.expect("request");
    assert_eq!(anonymous.status(), 401);

    let wrong = client()
        .get(&url)
        .header(TOKEN_HEADER, "not-the-token")
        .send()
        .await
        .expect("request");
    assert_eq!(wrong.status(), 401);

    let app = client()
        .get(&url)
        .header("origin", APP_ORIGIN)
        .header(TOKEN_HEADER, token())
        .send()
        .await
        .expect("request");
    assert_eq!(app.status(), 200);
    assert_eq!(
        app.headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some(APP_ORIGIN)
    );
}

#[tokio::test]
async fn a_foreign_page_is_refused_even_with_the_token() {
    let base = serve().await;

    let response = client()
        .post(format!("{base}/git/api/git/repo/x/checkout"))
        .header("origin", "https://example.com")
        .header(TOKEN_HEADER, token())
        .json(&serde_json::json!({ "ref_name": "main" }))
        .send()
        .await
        .expect("request");

    assert_eq!(response.status(), 403);
    assert!(response
        .headers()
        .get("access-control-allow-origin")
        .is_none());
}

#[tokio::test]
async fn a_rebound_hostname_is_refused() {
    let base = serve().await;

    let response = client()
        .get(format!("{base}{PROTECTED_ROUTE}"))
        .header("host", "attacker.example:13847")
        .header(TOKEN_HEADER, token())
        .send()
        .await
        .expect("request");

    assert_eq!(response.status(), 403);
}

/// A preflight carries no token. CORS must answer it before the check, and
/// only for the app's own origin.
#[tokio::test]
async fn preflight_is_answered_for_the_app_origin_only() {
    let base = serve().await;
    let preflight = |origin: &'static str| {
        client()
            .request(
                reqwest::Method::OPTIONS,
                format!("{base}/git/api/git/repo/x/checkout"),
            )
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                format!("content-type, {TOKEN_HEADER}"),
            )
            .send()
    };

    let app = preflight(APP_ORIGIN).await.expect("request");
    assert!(app.status().is_success(), "{}", app.status());
    assert_eq!(
        app.headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some(APP_ORIGIN)
    );

    let foreign = preflight("https://example.com").await.expect("request");
    assert!(foreign
        .headers()
        .get("access-control-allow-origin")
        .is_none());
}

/// `WebSocket` cannot set headers: the upgrade request carries the token in
/// the query string, and is refused without it.
#[tokio::test]
async fn websocket_upgrade_needs_the_query_token() {
    let base = serve().await;

    let anonymous = client()
        .get(format!("{base}/ws"))
        .send()
        .await
        .expect("request");
    assert_eq!(anonymous.status(), 401);

    // With the token the request reaches the handler, which then rejects it
    // for not being an upgrade — anything but the check's own 401 / 403.
    let authenticated = client()
        .get(format!("{base}/ws?{TOKEN_QUERY_PARAM}={}", token()))
        .send()
        .await
        .expect("request");
    assert!(
        ![401, 403].contains(&authenticated.status().as_u16()),
        "{}",
        authenticated.status()
    );
}

/// Hook subprocesses are not the webview and cannot obtain the API token, so
/// `/hooks/*` sits outside the check and answers with its own 401.
#[tokio::test]
async fn hook_routes_keep_their_own_authentication() {
    let base = serve().await;

    // A rebound hostname would be a 403 behind the check; here it reaches the
    // hook handler, which rejects the missing hook token itself.
    let response = client()
        .post(format!("{base}/hooks/provenance-ready"))
        .header("host", "attacker.example:13847")
        .send()
        .await
        .expect("request");

    assert_eq!(response.status(), 401);
}
