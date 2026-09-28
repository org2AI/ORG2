//! Query this installed runtime's defaults without opening either real profile.
//! The probe owns an empty home, denies networking, and never creates a thread.

use super::super::history_bootstrap::ResolvedCodexHistoryRoute;
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};

const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(14);
const REAP_TIMEOUT: Duration = Duration::from_secs(1);

/// Unavailable capability is `None`; owner/config/runtime fence errors remain
/// errors. Callers cache either answer by runtime and configuration generation.
pub(crate) fn isolated_default_route(
    command: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Option<ResolvedCodexHistoryRoute>, String> {
    check()?;
    let prepared = (|| {
        if !command.is_absolute() || !command.is_file() {
            return None;
        }
        let root = tempfile::tempdir().ok()?;
        let home = root.path().canonicalize().ok()?;
        let codex_home = home.join(".codex");
        std::fs::create_dir(&codex_home).ok()?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .ok()?;
        Some((root, home, codex_home, runtime))
    })();
    let Some((_root, home, codex_home, runtime)) = prepared else {
        check()?;
        return Ok(None);
    };
    check()?;
    let result = runtime.block_on(async {
        let mut child = match Command::new("/usr/bin/sandbox-exec")
            .args(["-p", "(version 1)(allow default)(deny network*)"])
            .arg(command)
            .args(["-c", "cli_auth_credentials_store=\"file\"", "app-server"])
            .env_clear()
            .env("HOME", &home)
            .env("CODEX_HOME", &codex_home)
            .env("TMPDIR", &home)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .current_dir(&home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return Ok(None),
        };
        let result = {
            let operation = async {
                let stdin = child.stdin.take().ok_or("probe stdin unavailable")?;
                let stdout = child.stdout.take().ok_or("probe stdout unavailable")?;
                let mut rpc = ProbeRpc {
                    stdin,
                    reader: BufReader::new(stdout),
                    remaining: MAX_OUTPUT,
                    next_id: 0,
                };
                rpc.request("initialize", json!({
                    "clientInfo": {"name": "orgii-default-route", "version": env!("CARGO_PKG_VERSION")},
                    "capabilities": {"experimentalApi": true}
                })).await?;
                super::super::rpc_notify(&mut rpc.stdin, "initialized").await?;
                let config = rpc.request("config/read", json!({
                    "cwd": home, "includeLayers": false
                })).await?;
                let models = rpc.request("model/list", json!({
                    "cursor": null, "limit": 100, "refresh": false
                })).await?;
                route_from_responses(&config, &models).ok_or_else(|| String::from("native default unknown"))
            };
            tokio::pin!(operation);
            let mut fence = tokio::time::interval(Duration::from_millis(100));
            let deadline = tokio::time::sleep(PROBE_TIMEOUT);
            tokio::pin!(deadline);
            loop {
                tokio::select! {
                    biased;
                    _ = fence.tick() => {
                        if let Err(reason) = check() { break Err(reason); }
                    }
                    _ = &mut deadline => break Ok(None),
                    value = &mut operation => break Ok(value.ok()),
                }
            }
        };
        // Reap before the temporary profile is removed, including cancellation,
        // protocol failures and timeouts. Drop is an additional kill fallback.
        let _ = child.start_kill();
        let _ = tokio::time::timeout(REAP_TIMEOUT, child.wait()).await;
        result
    });
    check()?;
    result
}

struct ProbeRpc {
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    remaining: usize,
    next_id: u64,
}

impl ProbeRpc {
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        // Share the native transport's wire codec, but bound the entire probe's
        // output rather than its usual transcript-bearing response reader.
        super::super::rpc_send(&mut self.stdin, id, method, params).await?;
        loop {
            let value = bounded_message(&mut self.reader, &mut self.remaining).await?;
            if value.get("method").is_some() || value.get("id").and_then(Value::as_u64) != Some(id)
            {
                continue;
            }
            if value.get("error").is_some() {
                return Err("native default probe request unavailable".into());
            }
            return value
                .get("result")
                .cloned()
                .ok_or_else(|| "native default probe result missing".into());
        }
    }
}

async fn bounded_message(
    reader: &mut (impl AsyncBufRead + Unpin),
    remaining: &mut usize,
) -> Result<Value, String> {
    let mut bytes = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| "native probe read failed")?;
        if available.is_empty() {
            return Err("native probe output ended".into());
        }
        let length = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if length > *remaining {
            return Err("native probe output limit".into());
        }
        *remaining -= length;
        bytes.extend_from_slice(&available[..length]);
        let complete = bytes.last() == Some(&b'\n');
        reader.consume(length);
        if complete {
            return serde_json::from_slice(&bytes)
                .map_err(|_| "native probe output invalid".into());
        }
    }
}

fn route_from_responses(config: &Value, models: &Value) -> Option<ResolvedCodexHistoryRoute> {
    let config = config.get("config")?.as_object()?;
    // This is the native config schema's built-in provider fallback, shared
    // with configured_route. A custom provider is never assigned its model.
    let provider = match config.get("model_provider")? {
        Value::Null => "openai",
        value => route_token(value.as_str()?)?,
    };
    if let Some(value) = config.get("model").filter(|value| !value.is_null()) {
        return Some(ResolvedCodexHistoryRoute {
            model: route_token(value.as_str()?)?.into(),
            provider: provider.into(),
        });
    }
    // A truncated catalog cannot prove uniqueness. Do not guess from ordering,
    // priority or the first model, nor use OpenAI defaults for custom providers.
    if provider != "openai" || models.get("nextCursor")? != &Value::Null {
        return None;
    }
    let mut defaults = models
        .get("data")?
        .as_array()?
        .iter()
        .filter(|model| model.get("isDefault") == Some(&Value::Bool(true)));
    let model = defaults.next()?;
    if defaults.next().is_some() {
        return None;
    }
    Some(ResolvedCodexHistoryRoute {
        model: route_token(model.get("model")?.as_str()?)?.into(),
        provider: provider.into(),
    })
}

fn route_token(value: &str) -> Option<&str> {
    (!value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control))
        .then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actual_default_marker_wins_without_version_or_priority_assumptions() {
        let config = json!({"config":{"model":null,"model_provider":null}});
        let models = json!({"data":[
            {"model":"first-but-not-default","isDefault":false},
            {"model":"new-runtime-default","isDefault":true}
        ],"nextCursor":null});
        assert_eq!(
            route_from_responses(&config, &models).unwrap(),
            ResolvedCodexHistoryRoute {
                model: "new-runtime-default".into(),
                provider: "openai".into()
            }
        );
        for unknown in [
            json!({"data":[{"model":"first","priority":1}],"nextCursor":null}),
            json!({"data":[{"model":"a","isDefault":true},{"model":"b","isDefault":true}],"nextCursor":null}),
            json!({"data":[{"model":"a","isDefault":true}],"nextCursor":"next"}),
            json!({"data":[{"model":"","isDefault":true}],"nextCursor":null}),
        ] {
            assert_eq!(route_from_responses(&config, &unknown), None);
        }
        assert_eq!(
            route_from_responses(
                &json!({"config":{"model":null,"model_provider":"custom"}}),
                &models
            ),
            None
        );
        assert_eq!(
            route_from_responses(
                &json!({"config":{"model":"own-model","model_provider":"custom"}}),
                &models
            )
            .unwrap()
            .provider,
            "custom"
        );
        assert_eq!(route_from_responses(&json!({"config":{}}), &models), None);
    }

    #[tokio::test]
    async fn output_bound_counts_all_messages_and_unterminated_lines() {
        let mut reader = BufReader::new(&b"{}\n{}\n"[..]);
        let mut budget = 5;
        bounded_message(&mut reader, &mut budget).await.unwrap();
        assert!(bounded_message(&mut reader, &mut budget)
            .await
            .unwrap_err()
            .contains("limit"));
        let mut reader = BufReader::new(&b"0123456789"[..]);
        assert!(bounded_message(&mut reader, &mut 5)
            .await
            .unwrap_err()
            .contains("limit"));
    }

    #[test]
    fn cancellation_is_not_reported_as_missing_capability() {
        assert_eq!(
            isolated_default_route(Path::new("/missing"), &|| Err("owner retired".into()))
                .unwrap_err(),
            "owner retired"
        );
        assert_eq!(
            isolated_default_route(Path::new("/missing"), &|| Ok(())).unwrap(),
            None
        );
    }
}
