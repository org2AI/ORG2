//! Direct OAuth routing for the Luna-only reserve pool. No generation retry,
//! result cache, timer or persisted model rewrite: consult current quota before send.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

type Probe = tokio::sync::OnceCell<Option<&'static str>>;
// Weak entries coalesce only overlapping lookups. Finished results and raw
// credentials are never retained; cancellation drops the HTTP future.
static IN_FLIGHT: OnceLock<Mutex<HashMap<[u8; 32], Weak<Probe>>>> = OnceLock::new();
const MAX_IN_FLIGHT: usize = 32;

pub const LUNA_MODEL: &str = "gpt-5.6-luna";
pub const RESERVE_MODEL: &str = "gpt-reserve";
pub const EXPOSURE_HEADER: &str = "x-openai-codex-luna-reserve";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

fn reserve_available(model: &str, usage: &Value) -> bool {
    if model != LUNA_MODEL {
        return false;
    }
    let ordinary = &usage["rate_limit"];
    if ordinary["allowed"].as_bool() != Some(false)
        || ordinary["limit_reached"].as_bool() != Some(true)
    {
        return false;
    }
    if usage["additional_rate_limits"]
        .as_array()
        .map_or(0, |entries| {
            entries
                .iter()
                .filter(|entry| entry["limit_name"].as_str() == Some(RESERVE_MODEL))
                .count()
        })
        != 1
    {
        return false;
    }
    let pools = super::quota::model_quotas_from_usage_json(usage);
    let mut matches = pools.iter().filter(|pool| pool.limit_id == RESERVE_MODEL);
    let Some(pool) = matches.next() else {
        return false;
    };
    matches.next().is_none()
        && pool.model == LUNA_MODEL
        && pool.allowed == Some(true)
        && pool.limit_reached == Some(false)
        && !pool.usage_items.is_empty()
        && pool
            .usage_items
            .iter()
            .all(|window| window.remaining_percentage > 0.0)
}

/// Returns an upstream-only override. The caller retains its selected model
/// for session identity and billing. Credentials must be the exact native OAuth
/// account used by the impending request, never a hosted/custom provider key.
pub async fn resolve_oauth_wire_model(
    client: &reqwest::Client,
    token: &str,
    account_id: Option<&str>,
    model: &str,
) -> Option<&'static str> {
    resolve_at(client, USAGE_URL, token, account_id, model).await
}

async fn resolve_at(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    account_id: Option<&str>,
    model: &str,
) -> Option<&'static str> {
    if model != LUNA_MODEL || token.trim().is_empty() {
        return None;
    }
    let mut digest = Sha256::new();
    for value in [url, token, account_id.unwrap_or_default()] {
        digest.update(value.len().to_le_bytes());
        digest.update(value.as_bytes());
    }
    let key: [u8; 32] = digest.finalize().into();
    let probe = {
        let mut active = IN_FLIGHT.get_or_init(Mutex::default).lock().ok()?;
        active.retain(|_, probe| probe.strong_count() > 0);
        if let Some(probe) = active.get(&key).and_then(Weak::upgrade) {
            probe
        } else {
            if active.len() >= MAX_IN_FLIGHT {
                return None;
            }
            let probe = Arc::new(Probe::new());
            active.insert(key, Arc::downgrade(&probe));
            probe
        }
    };
    *probe
        .get_or_init(|| fetch_at(client, url, token, account_id, model))
        .await
}

async fn fetch_at(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    account_id: Option<&str>,
    model: &str,
) -> Option<&'static str> {
    // One bounded, user-demanded GET. Failures retain the ordinary route; they
    // never trigger an app-server fallback, reset redemption or generation replay.
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let mut request = client
            .get(url)
            .bearer_auth(token)
            .header(EXPOSURE_HEADER, "1")
            .header("Accept", "application/json");
        if let Some(account_id) = account_id.filter(|id| !id.is_empty()) {
            request = request.header("ChatGPT-Account-Id", account_id);
        }
        let mut response = request.send().await.ok()?.error_for_status().ok()?;
        // Bound both the parsed body and its read time, including chunked bodies.
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > 256 * 1024 {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        let usage: Value = serde_json::from_slice(&bytes).ok()?;
        reserve_available(model, &usage).then_some(RESERVE_MODEL)
    })
    .await;
    result.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn read_headers(socket: &mut tokio::net::TcpStream) -> String {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        while !bytes.windows(4).any(|end| end == b"\r\n\r\n") {
            let mut buffer = [0; 1024];
            let count = socket.read(&mut buffer).await.unwrap();
            assert!(count > 0, "request ended before its headers");
            bytes.extend_from_slice(&buffer[..count]);
            assert!(bytes.len() <= 8192);
        }
        String::from_utf8(bytes).unwrap()
    }

    fn usage() -> Value {
        json!({"rate_limit": {"allowed": false, "limit_reached": true,
        "primary_window": {"used_percent": 100, "limit_window_seconds": 604800}},
        "additional_rate_limits": [{"limit_name": RESERVE_MODEL,
            "normal_model_slug": LUNA_MODEL, "rate_limit": {
                "allowed": true, "limit_reached": false,
                "primary_window": {"used_percent": 3, "limit_window_seconds": 604800}, "secondary_window": null
            }}]})
    }

    #[test]
    fn reserve_requires_positive_model_scoped_capacity() {
        let base = usage();
        assert!(reserve_available(LUNA_MODEL, &base));
        for model in [
            "gpt-6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-luna-medium",
            "gpt-reserve",
            "luna-org2-alias",
        ] {
            assert!(!reserve_available(model, &base));
        }
        for (pointer, value) in [
            ("/rate_limit/allowed", json!(true)),
            ("/rate_limit/limit_reached", json!(false)),
            (
                "/additional_rate_limits/0/normal_model_slug",
                json!("gpt-5.6-sol"),
            ),
            ("/additional_rate_limits/0/rate_limit/allowed", Value::Null),
            (
                "/additional_rate_limits/0/rate_limit/limit_reached",
                json!(true),
            ),
            (
                "/additional_rate_limits/0/rate_limit/primary_window/used_percent",
                json!(100),
            ),
            (
                "/additional_rate_limits/0/rate_limit/primary_window/used_percent",
                json!(-1),
            ),
            (
                "/additional_rate_limits/0/rate_limit/primary_window/used_percent",
                Value::Null,
            ),
        ] {
            let mut altered = base.clone();
            *altered.pointer_mut(pointer).unwrap() = value;
            assert!(!reserve_available(LUNA_MODEL, &altered), "{pointer}");
        }
        let mut duplicate = base.clone();
        duplicate["additional_rate_limits"]
            .as_array_mut()
            .unwrap()
            .push(base["additional_rate_limits"][0].clone());
        assert!(!reserve_available(LUNA_MODEL, &duplicate));
        let mut secondary = base;
        secondary["additional_rate_limits"][0]["rate_limit"]["secondary_window"] =
            json!({"used_percent": 100});
        assert!(!reserve_available(LUNA_MODEL, &secondary));
    }

    #[test]
    fn ingestion_preserves_reserve_without_inflating_ordinary_quota() {
        let quota = super::super::quota::quota_from_usage_json(&usage()).unwrap();
        assert_eq!(quota.remaining_percentage, 0.0);
        assert_eq!(quota.model_quotas.len(), 1);
        assert_eq!(quota.model_quotas[0].model, LUNA_MODEL);
        assert_eq!(
            quota.model_quotas[0].usage_items[0].remaining_percentage,
            97.0
        );
        let persisted = serde_json::to_value(&quota).unwrap();
        let restored: crate::types::QuotaInfo = serde_json::from_value(persisted).unwrap();
        assert_eq!(restored.model_quotas[0].limit_id, RESERVE_MODEL);
    }
    #[test]
    fn app_server_preserves_reserve_pool_but_missing_permission_is_unknown() {
        let response = serde_json::from_value(json!({
            "rateLimits": {"primary": {"usedPercent": 100, "windowDurationMins": 10080}},
            "rateLimitsByLimitId": { "gpt-reserve": {
                "primary": {"usedPercent": 3, "windowDurationMins": 10080, "resetsAt": 1890000000}, "secondary": null
            }}
        }))
        .unwrap();
        let quota = super::super::quota::quota_from_codex_rate_limits_response(response);
        assert_eq!(quota.remaining_percentage, 0.0);
        let pool = &quota.model_quotas[0];
        assert_eq!(pool.model, LUNA_MODEL);
        assert_eq!(pool.allowed, None);
        assert_eq!(pool.usage_items[0].remaining_percentage, 97.0);
        assert!(pool.usage_items[0].reset_time.is_some());
    }

    #[tokio::test]
    async fn fresh_account_scoped_probe_never_reuses_previous_capacity() {
        use tokio::io::AsyncWriteExt;
        crate::test_support::install_crypto_provider_for_tests();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/usage", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for (account, status, body) in [
                ("account-a", "200 OK", usage().to_string()),
                ("account-b", "200 OK", "{}".into()),
                ("account-a", "429 Too Many Requests", usage().to_string()),
                ("account-a", "200 OK", "malformed".into()),
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let request = read_headers(&mut socket).await.to_lowercase();
                assert!(request.starts_with("get /usage "));
                assert!(request.contains(&format!("chatgpt-account-id: {account}")));
                assert!(request.contains("authorization: bearer fixture-token"));
                assert!(request.contains(&format!("{EXPOSURE_HEADER}: 1")));
                socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let client = reqwest::Client::new();
        for (account, expected) in [
            ("account-a", Some(RESERVE_MODEL)),
            ("account-b", None),
            ("account-a", None),
            ("account-a", None),
        ] {
            assert_eq!(
                resolve_at(&client, &url, "fixture-token", Some(account), LUNA_MODEL).await,
                expected
            );
        }
        server.await.unwrap();
        // No request for unsupported models, even when the endpoint is absent.
        assert_eq!(
            resolve_at(
                &client,
                "http://127.0.0.1:1",
                "fixture-token",
                None,
                "gpt-5.6-sol"
            )
            .await,
            None
        );
    }
    #[tokio::test]
    async fn overlapping_probes_share_io_without_caching_the_result() {
        use tokio::io::AsyncWriteExt;
        crate::test_support::install_crypto_provider_for_tests();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/usage", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for body in [usage().to_string(), "{}".into()] {
                let (mut socket, _) = listener.accept().await.unwrap();
                read_headers(&mut socket).await;
                tokio::time::sleep(Duration::from_millis(20)).await;
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let client = reqwest::Client::new();
        let (first, second) = tokio::join!(
            resolve_at(&client, &url, "concurrent-fixture", None, LUNA_MODEL),
            resolve_at(&client, &url, "concurrent-fixture", None, LUNA_MODEL),
        );
        assert_eq!(first, Some(RESERVE_MODEL));
        assert_eq!(second, first);
        assert_eq!(
            resolve_at(&client, &url, "concurrent-fixture", None, LUNA_MODEL).await,
            None
        );
        server.await.unwrap();
        assert!(IN_FLIGHT.get().unwrap().lock().unwrap().len() <= MAX_IN_FLIGHT);
    }
    #[tokio::test]
    async fn oversized_and_stalled_usage_bodies_are_bounded() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        crate::test_support::install_crypto_provider_for_tests();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/usage", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            read_headers(&mut socket).await;
            let mut body = usage().to_string();
            body.push_str(&" ".repeat(256 * 1024));
            let _ = socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await;
            drop(socket);
            let (mut socket, _) = listener.accept().await.unwrap();
            read_headers(&mut socket).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{")
                .await
                .unwrap();
            // The client must drop the connection at its whole-probe deadline.
            assert_eq!(socket.read(&mut request).await.unwrap(), 0);
        });
        let client = reqwest::Client::new();
        assert_eq!(
            resolve_at(&client, &url, "bounded-fixture", None, LUNA_MODEL).await,
            None
        );
        let started = std::time::Instant::now();
        assert_eq!(
            resolve_at(&client, &url, "bounded-fixture", None, LUNA_MODEL).await,
            None
        );
        assert!(started.elapsed() < Duration::from_secs(7));
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
    }
}
