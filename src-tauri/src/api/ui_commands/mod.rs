//! Authenticated loopback UI transport. No agent session is needed.
mod commands;
mod terminal_commands;
use axum::{
    extract::{DefaultBodyLimit, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
pub use commands::*;
use serde::Deserialize;
use serde_json::json;
use std::{io::Write, sync::OnceLock};
pub use terminal_commands::*;

fn token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| uuid::Uuid::new_v4().to_string())
}
fn authorized(headers: &HeaderMap) -> bool {
    // Browser pages must not gain authority from permissive parent-router CORS.
    if headers.contains_key("origin") {
        return false;
    }
    let Some(candidate) = headers
        .get("x-orgii-ui-token")
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let expected = token().as_bytes();
    candidate.len() == expected.len()
        && candidate
            .as_bytes()
            .iter()
            .zip(expected)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}
fn denied() -> Response {
    (StatusCode::UNAUTHORIZED,Json(json!({"status":"failed","error":{"code":"UNAUTHORIZED","message":"UI access requires a local credential"}}))).into_response()
}
pub fn routes() -> Router {
    Router::new()
        .route("/ui/v1/info", get(info))
        .route("/ui/v1/execute", post(execute))
        .route("/ui/v1/receipt", get(receipt))
        .layer(DefaultBodyLimit::max(app_ui::MAX_BODY))
}
async fn info(headers: HeaderMap) -> Response {
    if !authorized(&headers) {
        return denied();
    }
    Json(app_ui::capabilities()).into_response()
}
async fn execute(headers: HeaderMap, body: axum::body::Bytes) -> Response {
    if !authorized(&headers) {
        return denied();
    }
    match serde_json::from_slice::<app_ui::Request>(&body) {
        Ok(request)=>Json(app_ui::broker().execute("local-cli",request).await).into_response(),
        Err(_)=>(StatusCode::BAD_REQUEST,Json(json!({"status":"failed","error":{"code":"INVALID_PARAMS","message":"Invalid UI request envelope"}}))).into_response(),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptQuery {
    request_id: String,
}
async fn receipt(headers: HeaderMap, Query(query): Query<ReceiptQuery>) -> Response {
    if !authorized(&headers) {
        return denied();
    }
    Json(app_ui::broker().receipt("local-cli",&query.request_id).map(|r|serde_json::to_value(r).unwrap()).unwrap_or_else(||json!({"status":"unknown","requestId":query.request_id,"error":{"code":"RECEIPT_UNAVAILABLE","message":"Pending, expired or unknown request; inspect target state"}}))).into_response()
}

/// Created after bind. Owned by the listener task, removed when that task ends.
pub struct Descriptor(std::path::PathBuf);
impl Drop for Descriptor {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
/// Remove descriptors that cannot belong to a live instance.
///
/// `Descriptor::drop` only runs if `start_server` returns, and it never does:
/// the process exits under `axum::serve`. Every launch would otherwise leave a
/// file behind, and `org2-ui`'s discovery hard-fails above 64 candidates — so
/// without this the CLI stops working after roughly 65 app starts.
///
/// Liveness is **not** decided by probing the port. `ide_server_port` is
/// deterministic (`DEFAULT_IDE_SERVER_PORT`, an instance offset, or
/// `ORGII_IDE_SERVER_PORT`), so every descriptor this install ever wrote names
/// the same port, and this runs *after* we bound it — a loopback connect
/// completes against our own backlog whether or not anything ever calls
/// `accept`, so probing would mark every stale descriptor live and sweep
/// nothing. Binding the port is itself the proof: nothing else is serving it.
fn sweep(directory: &std::path::Path, own_port: u16, own_instance: &str) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.take(512).flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let descriptor = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        let Some(descriptor) = descriptor else {
            // Unreadable or unparsable: no caller can use it either.
            let _ = std::fs::remove_file(&path);
            continue;
        };
        if descriptor["instanceId"].as_str() == Some(own_instance) {
            continue;
        }
        let stale = match descriptor["port"].as_u64() {
            // We hold this port, and this descriptor is not ours.
            Some(port) if port == u64::from(own_port) => true,
            // Another port: trust the recorded pid, and treat a descriptor
            // written before pids were recorded as stale.
            _ => descriptor["pid"]
                .as_u64()
                .and_then(|pid| u32::try_from(pid).ok())
                .is_none_or(|pid| !process_is_alive(pid)),
        };
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    // Signal 0 performs the permission and existence checks without delivering
    // anything.
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // EPERM means it exists under another user, which still counts.
    // `__error()` is macOS-only, so read errno through std instead.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_is_alive(_pid: u32) -> bool {
    // No cheap liveness check here; the own-port rule above covers the case
    // this sweep exists for, so err towards keeping the descriptor.
    true
}

pub async fn publish(port: u16) -> std::io::Result<Descriptor> {
    tokio::task::spawn_blocking(move || {
        let directory = app_paths::orgii_root().join("ui/instances");
        std::fs::create_dir_all(&directory)?;
        // Runs after the listener bound `port`, which is what makes the
        // own-port rule sound.
        let id = &app_ui::broker().instance_id;
        sweep(&directory, port, id);
        let path = directory.join(format!("{id}.json"));
        let temp = directory.join(format!(".{id}.tmp"));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        let result = (|| {
            app_paths::set_sensitive_file_permissions(&temp)?;
            file.write_all(
                serde_json::to_string(
                    &json!({"instanceId":id,"port":port,"token":token(),"pid":std::process::id()}),
                )?
                .as_bytes(),
            )?;
            file.sync_all()?;
            std::fs::rename(&temp, &path)?;
            Ok(Descriptor(path))
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result
    })
    .await
    .map_err(std::io::Error::other)?
}

#[cfg(test)]
mod tests;
