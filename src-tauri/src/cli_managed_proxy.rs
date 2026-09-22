mod execution_profile;
pub(crate) use execution_profile::prepare_execution_profile;
mod session_routes;
use crate::dynamic_credentials::Authentication;
use axum::{
    body::{to_bytes, Body},
    extract::Path,
    http::{header::CONTENT_TYPE, HeaderMap, Method, Request, Response, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use key_vault::key_store::KEY_SERVICE;
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Mutex, OnceLock,
};
use std::time::Duration;

const MANAGED_CODEX_AGENT: &str = "codex";
const MANAGED_CLAUDE_CODE_AGENT: &str = "claude_code";
const DEFAULT_CODEX_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const ORGII_CURRENT_MODEL: &str = "orgii-current-model";
const MAX_PROXY_BODY_BYTES: usize = 64 * 1024 * 1024;
const OPENAI_API_PROVIDER: &str = "openai_api";
const ANTHROPIC_API_PROVIDER: &str = "anthropic_api";
const MAX_PROXY_RETRY_DELAY_SECS: u64 = 30;

static PROXY_START_REQUESTED: AtomicBool = AtomicBool::new(false);
static PROXY_RUNNING: AtomicBool = AtomicBool::new(false);
static PROXY_RETRY_ATTEMPT: AtomicU32 = AtomicU32::new(0);
static PROXY_LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static PROXY_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliManagedProxyStatus {
    pub agent_name: String,
    pub supported: bool,
    pub running: bool,
    pub ready: bool,
    pub url: String,
    pub selected_key_id: Option<String>,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub upstream_base_url: Option<String>,
    pub compatible_key_ids: Vec<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum ProxyProtocol {
    OpenAi,
    Anthropic,
}

#[derive(Debug, Clone)]
struct ProxyContext {
    authentication: Authentication,
    key_id: String,
    provider: String,
    model: String,
    upstream_base_url: String,
    api_key: String,
    proxy_token: String,
    protocol: ProxyProtocol,
}

#[derive(Debug, Clone, Copy)]
struct ProxyAgentDescriptor {
    protocol: ProxyProtocol,
    protocol_name: &'static str,
    display_name: &'static str,
    requires_openai_responses: bool,
}

pub fn start_cli_managed_proxy_thread() {
    if PROXY_START_REQUESTED.swap(true, Ordering::SeqCst) {
        return;
    }

    // Async-IO proxy: two workers cover many concurrent CLI streams without
    // paying for a core-count worker pool.
    std::thread::spawn(|| {
        match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => {
                rt.block_on(supervise_proxy_server());
                PROXY_RUNNING.store(false, Ordering::SeqCst);
                PROXY_START_REQUESTED.store(false, Ordering::SeqCst);
            }
            Err(err) => {
                PROXY_RUNNING.store(false, Ordering::SeqCst);
                PROXY_START_REQUESTED.store(false, Ordering::SeqCst);
                set_proxy_last_error(Some(format!("Failed to create proxy runtime: {err}")));
                tracing::error!(error = %err, "[CLI Managed Proxy] failed to create tokio runtime");
            }
        }
    });
}

async fn supervise_proxy_server() {
    loop {
        let error = match run_proxy_server().await {
            Ok(()) => "Proxy server stopped unexpectedly".to_string(),
            Err(err) => err,
        };
        PROXY_RUNNING.store(false, Ordering::SeqCst);
        set_proxy_last_error(Some(error.clone()));

        let attempt = PROXY_RETRY_ATTEMPT.fetch_add(1, Ordering::SeqCst) + 1;
        let retry_delay_secs = proxy_retry_delay_secs(attempt);
        tracing::warn!(
            error = %error,
            attempt,
            retry_delay_secs,
            "[CLI Managed Proxy] unavailable; retrying"
        );
        tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
    }
}

fn proxy_retry_delay_secs(attempt: u32) -> u64 {
    let exponent = attempt.saturating_sub(1).min(5);
    (1_u64 << exponent).min(MAX_PROXY_RETRY_DELAY_SECS)
}

fn set_proxy_last_error(error: Option<String>) {
    let state = PROXY_LAST_ERROR.get_or_init(|| Mutex::new(None));
    match state.lock() {
        Ok(mut value) => *value = error,
        Err(poisoned) => *poisoned.into_inner() = error,
    }
}

fn proxy_last_error() -> Option<String> {
    let state = PROXY_LAST_ERROR.get_or_init(|| Mutex::new(None));
    match state.lock() {
        Ok(value) => value.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn proxy_unavailable_message() -> String {
    if let Some(error) = proxy_last_error() {
        let attempt = PROXY_RETRY_ATTEMPT.load(Ordering::SeqCst).max(1);
        return format!(
            "Local proxy is unavailable and will retry automatically (attempt {attempt}): {error}"
        );
    }
    if PROXY_START_REQUESTED.load(Ordering::SeqCst) {
        "Local proxy is starting".to_string()
    } else {
        "Local proxy has not started".to_string()
    }
}

type ResolveProxyContext = dyn Fn(&str) -> Result<ProxyContext, String> + Send + Sync;
#[derive(Clone)]
struct ContextResolver(std::sync::Arc<ResolveProxyContext>);

fn proxy_router(resolver: ContextResolver) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/proxy/{token}/v1", any(proxy_v1_root_handler))
        .route("/proxy/{token}/v1/{*path}", any(proxy_v1_handler))
        .route("/proxy/{token}/claude", any(proxy_claude_root_handler))
        .route("/proxy/{token}/claude/{*path}", any(proxy_claude_handler))
        .route("/cli/{agent}/{token}/v1", any(cli_v1_root_handler))
        .route("/cli/{agent}/{token}/v1/{*path}", any(cli_v1_handler))
        .route("/cli/{agent}/{token}/claude", any(cli_claude_root_handler))
        .route(
            "/cli/{agent}/{token}/claude/{*path}",
            any(cli_claude_handler),
        )
        .layer(axum::Extension(resolver))
}

async fn run_proxy_server() -> Result<(), String> {
    let addr = std::net::SocketAddr::from((
        [127, 0, 0, 1],
        agent_cli::managed_config::managed_proxy_port(),
    ));
    let app = proxy_router(ContextResolver(std::sync::Arc::new(resolve_proxy_context)));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|err| format!("Failed to bind {addr}: {err}"))?;

    PROXY_RETRY_ATTEMPT.store(0, Ordering::SeqCst);
    set_proxy_last_error(None);
    PROXY_RUNNING.store(true, Ordering::SeqCst);
    tracing::info!("[CLI Managed Proxy] listening on http://{}", addr);
    let result = axum::serve(listener, app)
        .await
        .map_err(|err| format!("Proxy server error: {err}"));
    PROXY_RUNNING.store(false, Ordering::SeqCst);
    result
}

async fn health_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "service": "orgii-cli-managed-proxy",
            "protocolVersion": 1,
            "running": true,
            "url": agent_cli::managed_config::managed_proxy_url(),
        })),
    )
        .into_response()
}

async fn proxy_v1_root_handler(
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    proxy_agent_handler(MANAGED_CODEX_AGENT, token, String::new(), request).await
}

async fn proxy_v1_handler(
    Path((token, path)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    proxy_agent_handler(MANAGED_CODEX_AGENT, token, path, request).await
}

async fn proxy_claude_root_handler(
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    if request.method() == Method::HEAD {
        return authenticated_empty_ok_response(MANAGED_CLAUDE_CODE_AGENT, &token);
    }

    proxy_agent_handler(MANAGED_CLAUDE_CODE_AGENT, token, String::new(), request).await
}

async fn proxy_claude_handler(
    Path((token, path)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    if request.method() == Method::HEAD && path == "v1" {
        return authenticated_empty_ok_response(MANAGED_CLAUDE_CODE_AGENT, &token);
    }

    proxy_agent_handler(MANAGED_CLAUDE_CODE_AGENT, token, path, request).await
}

async fn cli_v1_root_handler(
    Path((agent, token)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    proxy_agent_handler(&agent, token, String::new(), request).await
}

async fn cli_v1_handler(
    Path((agent, token, path)): Path<(String, String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    proxy_agent_handler(&agent, token, path, request).await
}

async fn cli_claude_root_handler(
    Path((agent, token)): Path<(String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    if request.method() == Method::HEAD {
        return authenticated_empty_ok_response(&agent, &token);
    }
    proxy_agent_handler(&agent, token, String::new(), request).await
}

async fn cli_claude_handler(
    Path((agent, token, path)): Path<(String, String, String)>,
    request: Request<Body>,
) -> Response<Body> {
    if request.method() == Method::HEAD && path == "v1" {
        return authenticated_empty_ok_response(&agent, &token);
    }
    proxy_agent_handler(&agent, token, path, request).await
}

async fn proxy_agent_handler(
    agent_name: &str,
    supplied_token: String,
    path: String,
    request: Request<Body>,
) -> Response<Body> {
    let resolved = session_routes::resolve(agent_name, &supplied_token).and_then(|session| {
        session.map(Ok).unwrap_or_else(|| {
            request
                .extensions()
                .get::<ContextResolver>()
                .ok_or_else(|| "Proxy context resolver unavailable".to_string())
                .and_then(|resolver| (resolver.0)(agent_name))
        })
    });
    let mut context = match resolved {
        Ok(context) => context,
        Err(err) => {
            return json_error(StatusCode::PRECONDITION_FAILED, err);
        }
    };
    if !proxy_token_matches(&context.proxy_token, &supplied_token) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Invalid ORG2 proxy token".to_string(),
        );
    }
    let query = forwarded_query(&context.protocol, request.uri().query());
    let path = match query {
        Some(query) if !query.is_empty() => format!("{path}?{query}"),
        _ => path,
    };

    let (parts, body) = request.into_parts();
    let body_bytes = match to_bytes(body, MAX_PROXY_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(err) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                format!("Failed to read proxy request body: {err}"),
            );
        }
    };

    let mut outbound_body = body_bytes.to_vec();
    let mut json_body = if is_json_request(&parts.headers) && !outbound_body.is_empty() {
        match serde_json::from_slice::<Value>(&outbound_body) {
            Ok(value) => Some(value),
            Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid JSON request".into()),
        }
    } else {
        None
    };
    let source = match crate::dynamic_credentials::source(&context.key_id) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::PRECONDITION_FAILED, error),
    };
    let mut resolved_model = false;
    if let Some(source) = source {
        if !outbound_body.is_empty() && json_body.as_ref().is_none_or(|value| !value.is_object()) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "Dynamic model requests require a JSON object".into(),
            );
        }
        if json_body
            .as_ref()
            .and_then(|value| value.get("model"))
            .is_some_and(|model| !model.is_string())
        {
            return json_error(StatusCode::BAD_REQUEST, "Invalid request model".into());
        }
        if parts.method == Method::GET
            && matches!(
                path.split('?').next().unwrap_or_default(),
                "models" | "v1/models"
            )
        {
            match source.models(&context.key_id, agent_name) {
                Ok(Some(models)) => {
                    let data: Vec<_> = models.iter().map(|model| serde_json::json!({
                        "id": model.id, "display_name": model.label, "object": "model", "type": "model"
                    })).collect();
                    return axum::Json(
                        serde_json::json!({"object":"list", "data":data, "has_more":false}),
                    )
                    .into_response();
                }
                Ok(None) => {}
                Err(error) => return json_error(StatusCode::PRECONDITION_FAILED, error),
            }
        }
        let requested = json_body
            .as_ref()
            .and_then(|value| value.get("model"))
            .and_then(Value::as_str)
            .filter(|model| *model != ORGII_CURRENT_MODEL)
            .unwrap_or(&context.model);
        match source.request_selection(&context.key_id, agent_name, requested) {
            Ok(Some(route)) => {
                context.key_id = route.selection;
                context.model = route.model;
                resolved_model = true;
            }
            Ok(None) => {}
            Err(error) => return json_error(StatusCode::BAD_REQUEST, error),
        }
    }
    match crate::dynamic_credentials::source(&context.key_id) {
        Ok(Some(source)) => match source.credential(&context.key_id, agent_name).await {
            Ok(credential) => {
                context.authentication = credential.destination.authentication;
                context.api_key = credential.secret;
                context.provider = credential.destination.provider;
                context.upstream_base_url = credential.destination.base_url;
            }
            Err(error) => return json_error(StatusCode::PRECONDITION_FAILED, error),
        },
        Ok(None) => {}
        Err(error) => return json_error(StatusCode::PRECONDITION_FAILED, error),
    }

    if let Some(ref mut value) = json_body {
        if resolved_model {
            rewrite_model_field(value, &context.model);
        } else {
            rewrite_request_model(value, &context);
        }
        match serde_json::to_vec(value) {
            Ok(bytes) => outbound_body = bytes,
            Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid JSON request".into()),
        }
    }

    forward_request(parts.method, &parts.headers, &context, &path, outbound_body).await
}

fn empty_ok_response() -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .body(Body::empty())
        .unwrap_or_else(|err| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build proxy response: {err}"),
            )
        })
}

fn authenticated_empty_ok_response(agent_name: &str, supplied_token: &str) -> Response<Body> {
    let context = match session_routes::resolve(agent_name, supplied_token).and_then(|session| {
        session
            .map(Ok)
            .unwrap_or_else(|| resolve_proxy_context(agent_name))
    }) {
        Ok(context) => context,
        Err(err) => return json_error(StatusCode::PRECONDITION_FAILED, err),
    };
    if !proxy_token_matches(&context.proxy_token, supplied_token) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Invalid ORG2 proxy token".to_string(),
        );
    }
    empty_ok_response()
}

async fn forward_request(
    method: Method,
    incoming_headers: &HeaderMap,
    context: &ProxyContext,
    path: &str,
    body: Vec<u8>,
) -> Response<Body> {
    let client = PROXY_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    });
    let url = match context.protocol {
        ProxyProtocol::OpenAi => build_upstream_url(&context.upstream_base_url, path),
        ProxyProtocol::Anthropic => build_anthropic_upstream_url(&context.upstream_base_url, path),
    };
    let url = match url {
        Ok(url) => url,
        Err(err) => return json_error(StatusCode::BAD_GATEWAY, err),
    };

    let req_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);
    let mut builder = client.request(req_method, url);

    for (name, value) in incoming_headers {
        if should_forward_header(name.as_str()) {
            builder = builder.header(name.as_str(), value.as_bytes());
        }
    }

    builder = apply_auth_header(
        builder,
        &context.protocol,
        &context.provider,
        &context.api_key,
        context.authentication,
    );
    if !incoming_headers.contains_key(CONTENT_TYPE) {
        builder = builder.header(CONTENT_TYPE.as_str(), "application/json");
    }

    let response = match builder.body(body).send().await {
        Ok(response) => response,
        Err(err) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to connect to upstream provider: {err}"),
            );
        }
    };

    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = response.headers().clone();

    let mut out = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if should_forward_response_header(name.as_str()) {
            out = out.header(name, value);
        }
    }
    out.body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(|err| {
            json_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to build proxy response: {err}"),
            )
        })
}

fn proxy_token_matches(expected: &str, supplied: &str) -> bool {
    if expected.len() != supplied.len() {
        return false;
    }
    expected
        .as_bytes()
        .iter()
        .zip(supplied.as_bytes())
        .fold(0_u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

fn forwarded_query(_protocol: &ProxyProtocol, query: Option<&str>) -> Option<String> {
    query.filter(|value| !value.is_empty()).map(str::to_string)
}

fn is_json_request(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("json"))
        .unwrap_or(true)
}

// Market validates the requested model against the purchase at the gateway.
// Preserve explicit model IDs so native model switching does not silently bill
// and execute the default model instead. The ORG2 placeholder still resolves.
fn rewrite_request_model(value: &mut Value, context: &ProxyContext) {
    if context.provider == "market"
        && value
            .get("model")
            .is_some_and(|model| model != ORGII_CURRENT_MODEL)
    {
        return;
    }
    rewrite_model_field(value, &context.model);
}

fn rewrite_model_field(value: &mut Value, selected_model: &str) {
    let Some(object) = value.as_object_mut() else {
        return;
    };

    match object.get("model").and_then(Value::as_str) {
        Some(model) if model == ORGII_CURRENT_MODEL || model != selected_model => {
            object.insert(
                "model".to_string(),
                Value::String(selected_model.to_string()),
            );
        }
        None => {
            object.insert(
                "model".to_string(),
                Value::String(selected_model.to_string()),
            );
        }
        _ => {}
    }
}

fn build_upstream_url(base_url: &str, path: &str) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(base_url).map_err(|err| format!("Invalid upstream base URL: {err}"))?;
    let (path, incoming_query) = path.split_once('?').unwrap_or((path, ""));
    let base_path = url.path().trim_end_matches('/');
    let incoming_path = path.trim_start_matches('/');
    let combined_path = if incoming_path.is_empty() {
        base_path.to_string()
    } else if base_path.is_empty() || base_path == "/" {
        format!("/{incoming_path}")
    } else {
        format!("{base_path}/{incoming_path}")
    };
    let base_query = url.query().map(str::to_string);
    let combined_query = match (base_query, incoming_query.is_empty()) {
        (Some(query), false) => Some(format!("{query}&{incoming_query}")),
        (Some(query), true) => Some(query),
        (None, false) => Some(incoming_query.to_string()),
        (None, true) => None,
    };
    url.set_path(&combined_path);
    url.set_query(combined_query.as_deref());
    Ok(url.to_string())
}

fn strip_path_prefix(path: &str, prefix: &str) -> String {
    let (path_only, query) = path.split_once('?').unwrap_or((path, ""));
    let stripped = path_only.strip_prefix(prefix).unwrap_or(path_only);
    if query.is_empty() {
        stripped.to_string()
    } else {
        format!("{stripped}?{query}")
    }
}

fn build_anthropic_upstream_url(base_url: &str, path: &str) -> Result<String, String> {
    let base_path = reqwest::Url::parse(base_url)
        .map_err(|err| format!("Invalid Anthropic upstream base URL: {err}"))?
        .path()
        .trim_end_matches('/')
        .to_string();
    let path = if base_path.ends_with("/v1") {
        strip_path_prefix(path.trim_start_matches('/'), "v1/")
    } else {
        path.to_string()
    };
    build_upstream_url(base_url, &path)
}

fn should_forward_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !matches!(
        lower.as_str(),
        "authorization"
            | "x-api-key"
            | "x-goog-api-key"
            | "api-key"
            | "host"
            | "content-length"
            | "connection"
            | "keep-alive"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn should_forward_response_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !matches!(
        lower.as_str(),
        "content-length"
            | "connection"
            | "keep-alive"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn apply_auth_header(
    builder: reqwest::RequestBuilder,
    protocol: &ProxyProtocol,
    provider: &str,
    api_key: &str,
    authentication: Authentication,
) -> reqwest::RequestBuilder {
    if matches!(authentication, Authentication::Bearer) {
        return builder.header("Authorization", format!("Bearer {api_key}"));
    }
    match protocol {
        ProxyProtocol::OpenAi if provider == "azure_openai_api" => {
            builder.header("api-key", api_key)
        }
        ProxyProtocol::OpenAi => builder.header("Authorization", format!("Bearer {api_key}")),
        ProxyProtocol::Anthropic if provider == "azure_anthropic_api" => {
            builder.header("api-key", api_key)
        }
        ProxyProtocol::Anthropic => builder.header("x-api-key", api_key),
    }
}

fn protocol_for_agent(agent_name: &str) -> Result<ProxyAgentDescriptor, String> {
    use agent_cli::managed_config::CliManagedProxyProtocol;

    if agent_name == agent_cli::managed_config::desktop::TARGET {
        return Ok(ProxyAgentDescriptor {
            protocol: ProxyProtocol::Anthropic,
            protocol_name: "anthropic",
            display_name: "Claude Desktop",
            requires_openai_responses: false,
        });
    }

    let proxy_protocol = agent_cli::managed_config::managed_proxy_protocol_for_agent(agent_name)
        .ok_or_else(|| {
            agent_cli::managed_config::managed_config_unavailable_reason_for_agent(agent_name)
                .map(str::to_string)
                .unwrap_or_else(|| format!("CLI managed proxy is not registered for {agent_name}"))
        })?;
    let display_name = key_vault::cli_agent_display_name(agent_name)
        .ok_or_else(|| format!("Missing CLI registry entry for {agent_name}"))?;
    let (protocol, protocol_name, requires_openai_responses) = match proxy_protocol {
        CliManagedProxyProtocol::OpenAiResponses => (ProxyProtocol::OpenAi, "openai", true),
        CliManagedProxyProtocol::OpenAiChatCompletions => (ProxyProtocol::OpenAi, "openai", false),
        CliManagedProxyProtocol::AnthropicMessages => {
            (ProxyProtocol::Anthropic, "anthropic", false)
        }
    };
    Ok(ProxyAgentDescriptor {
        protocol,
        protocol_name,
        display_name,
        requires_openai_responses,
    })
}

fn resolve_proxy_context_for_selection(
    agent_name: &str,
    key_id: Option<&str>,
    selected_model: Option<&str>,
    proxy_token: String,
) -> Result<ProxyContext, String> {
    let descriptor = protocol_for_agent(agent_name)?;
    if let Some(selection) = key_id {
        if let Some(source) = crate::dynamic_credentials::source(selection)? {
            let destination = source.destination(selection, agent_name)?;
            let model = selected_model
                .filter(|m| !m.is_empty())
                .ok_or("No model selected")?;
            return Ok(ProxyContext {
                authentication: destination.authentication,
                key_id: selection.into(),
                provider: destination.provider,
                model: model.into(),
                upstream_base_url: destination.base_url,
                api_key: String::new(),
                proxy_token,
                protocol: descriptor.protocol,
            });
        }
    }

    if matches!(agent_name, "claude_code" | "codex") {
        let key_id = key_id
            .filter(|value| !value.trim().is_empty())
            .ok_or("No KeyVault key selected")?;
        let key = KEY_SERVICE
            .get_key_by_id(key_id)
            .ok_or("Selected KeyVault key does not exist")?;
        let connection = key_vault::harness_connections::resolve(agent_name, &key, selected_model)?;
        return Ok(ProxyContext {
            authentication: Authentication::ProtocolDefault,
            key_id: connection.key_id,
            provider: connection.provider,
            model: connection.model,
            upstream_base_url: connection.base_url,
            api_key: connection.api_key,
            proxy_token,
            protocol: descriptor.protocol,
        });
    }
    let protocol = descriptor.protocol;
    let protocol_name = descriptor.protocol_name;
    let agent_display = descriptor.display_name;
    let key_id = key_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("No KeyVault key selected for {agent_display} managed config"))?;

    let key = KEY_SERVICE
        .get_key_by_id(key_id)
        .ok_or_else(|| format!("Selected KeyVault key does not exist: {key_id}"))?;

    if !key.enabled {
        return Err("Selected KeyVault key is disabled".to_string());
    }

    let provider = key.model_type.as_str().to_string();

    if !key_vault::is_cli_provider_compatible(agent_name, &provider) {
        return Err(format!(
            "Provider {provider} is not registered as compatible with {agent_display}"
        ));
    }

    if descriptor.requires_openai_responses && provider != OPENAI_API_PROVIDER {
        return Err(format!(
            "Provider {provider} is OpenAI-compatible but is not verified for the Responses API required by {agent_display} managed config"
        ));
    }

    let provider_config = key_vault::provider_config::get_provider_config(&provider);
    if !provider_config
        .supported_protocols
        .iter()
        .any(|protocol| protocol == protocol_name)
    {
        return Err(format!(
            "Provider {provider} is not {protocol_name}-compatible for {agent_display} managed proxy"
        ));
    }

    let api_key = key
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Selected key has no API key material. OAuth/subscription proxying is not supported yet."
                .to_string()
        })?
        .to_string();

    let upstream_base_url = key
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| match protocol {
            ProxyProtocol::OpenAi => provider_config.default_base_url.clone(),
            ProxyProtocol::Anthropic => provider_config
                .default_anthropic_base_url()
                .or(provider_config.default_base_url.clone()),
        })
        .or_else(|| {
            if matches!(protocol, ProxyProtocol::OpenAi) && provider == OPENAI_API_PROVIDER {
                Some(DEFAULT_CODEX_OPENAI_BASE_URL.to_string())
            } else if matches!(protocol, ProxyProtocol::Anthropic)
                && provider == ANTHROPIC_API_PROVIDER
            {
                Some(DEFAULT_ANTHROPIC_BASE_URL.to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Provider {provider} requires a base URL before proxying"))?;
    let parsed_base_url = reqwest::Url::parse(&upstream_base_url)
        .map_err(|err| format!("Provider {provider} has an invalid base URL: {err}"))?;
    if !matches!(parsed_base_url.scheme(), "http" | "https") {
        return Err(format!(
            "Provider {provider} base URL must use http or https"
        ));
    }

    let configured_models = if key.enabled_models.is_empty() {
        &key.available_models
    } else {
        &key.enabled_models
    };
    let requested_model = selected_model
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let model = match requested_model {
        Some(model)
            if configured_models
                .iter()
                .any(|candidate| candidate.trim() == model) =>
        {
            model.to_string()
        }
        Some(model) => {
            return Err(format!(
                "Model {model} is not enabled for the selected KeyVault key"
            ));
        }
        None => configured_models
            .iter()
            .map(|model| model.trim())
            .find(|model| !model.is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("No model selected for {agent_display} managed config"))?,
    };

    Ok(ProxyContext {
        authentication: Authentication::ProtocolDefault,
        key_id: key_id.to_string(),
        provider,
        model,
        upstream_base_url,
        api_key,
        proxy_token,
        protocol,
    })
}

fn resolve_proxy_context(agent_name: &str) -> Result<ProxyContext, String> {
    let agent_display = protocol_for_agent(agent_name)?.display_name;
    let selection = agent_cli::managed_config::managed_selection_for_agent(agent_name)?
        .ok_or_else(|| format!("{agent_display} is not in ORG2 Managed config mode"))?;
    let proxy_token = selection
        .proxy_token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!("{agent_display} managed config predates proxy authentication; apply it again")
        })?;
    resolve_proxy_context_for_selection(
        agent_name,
        selection.selected_key_id.as_deref(),
        selection.selected_model.as_deref(),
        proxy_token,
    )
}

fn compatible_key_ids_for_agent(agent_name: &str) -> Vec<String> {
    KEY_SERVICE
        .list_keys()
        .into_iter()
        .filter(|key| {
            resolve_proxy_context_for_selection(agent_name, Some(&key.id), None, String::new())
                .is_ok()
        })
        .map(|key| key.id)
        .collect()
}

pub(crate) async fn ensure_managed_proxy_running() -> Result<(), String> {
    start_cli_managed_proxy_thread();
    for _ in 0..20 {
        if PROXY_RUNNING.load(Ordering::SeqCst) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if PROXY_RUNNING.load(Ordering::SeqCst) {
        Ok(())
    } else {
        Err(proxy_unavailable_message())
    }
}

/// Application adapter for trusted dynamic sources; normal KeyVault selection
/// still uses its endpoint/model test receipt path below.
#[cfg(feature = "market-connect")]
pub(crate) async fn enable_dynamic_managed<
    G: crate::dynamic_credentials::OperationAuthorization + 'static,
>(
    agent: String,
    key: String,
    model: String,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
    native_app: Option<agent_cli::managed_config::native_app::NativeAppProfile>,
    authorization: impl std::future::Future<Output = Result<G, String>>,
) -> Result<agent_cli::managed_config::CliConfigManagedStatus, String> {
    if !matches!(agent.as_str(), "claude_code" | "codex") || model.is_empty() || model.len() > 256 {
        return Err("Unsupported dynamic client selection".into());
    }
    let source =
        crate::dynamic_credentials::source(&key)?.ok_or("Dynamic credential source required")?;
    source.credential(&key, &agent).await?;
    ensure_managed_proxy_running().await?;
    let authorization = authorization.await?;
    tokio::task::spawn_blocking(move || {
        authorization.check()?;
        if !PROXY_RUNNING.load(Ordering::SeqCst) {
            return Err(proxy_unavailable_message());
        }
        let context =
            resolve_proxy_context_for_selection(&agent, Some(&key), Some(&model), String::new())?;
        if let Some(profile) = native_app {
            return agent_cli::managed_config::enable_native_app(
                &profile,
                key,
                context.provider,
                model,
                None,
                None,
                &expected_hashes,
            );
        }
        agent_cli::managed_config::enable_orgii_managed_checked(
            &agent,
            Some(key),
            Some(context.provider),
            Some(model),
            false,
            Some(&expected_hashes),
        )
    })
    .await
    .map_err(|_| "Client configuration task failed")?
}

#[cfg(feature = "market-connect")]
pub(crate) async fn enable_dynamic_catalog<
    G: crate::dynamic_credentials::OperationAuthorization + 'static,
>(
    agent: String,
    key: String,
    model: String,
    catalog: agent_cli::managed_config::model_catalog::ModelCatalog,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
    native_app: Option<agent_cli::managed_config::native_app::NativeAppProfile>,
    authorization: impl std::future::Future<Output = Result<G, String>>,
) -> Result<agent_cli::managed_config::CliConfigManagedStatus, String> {
    let source =
        crate::dynamic_credentials::source(&key)?.ok_or("Dynamic credential source required")?;
    source.credential(&key, &agent).await?;
    ensure_managed_proxy_running().await?;
    let authorization = authorization.await?;
    tokio::task::spawn_blocking(move || {
        authorization.check()?;
        if !PROXY_RUNNING.load(Ordering::SeqCst) {
            return Err(proxy_unavailable_message());
        }
        let context =
            resolve_proxy_context_for_selection(&agent, Some(&key), Some(&model), String::new())?;
        if let Some(profile) = native_app {
            return agent_cli::managed_config::enable_native_app(
                &profile,
                key,
                context.provider,
                model,
                Some(&catalog),
                None,
                &expected_hashes,
            );
        }
        agent_cli::managed_config::enable_orgii_managed_catalog(
            &agent,
            key,
            context.provider,
            model,
            &catalog,
            &expected_hashes,
        )
    })
    .await
    .map_err(|_| "Client configuration task failed")?
}

#[cfg(feature = "market-connect")]
pub(crate) async fn enable_dynamic_desktop<
    G: crate::dynamic_credentials::OperationAuthorization + 'static,
>(
    key: String,
    model: String,
    models: Vec<agent_cli::managed_config::model_catalog::PickerModel>,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
    native_app: Option<agent_cli::managed_config::native_app::NativeAppProfile>,
    authorization: impl std::future::Future<Output = Result<G, String>>,
) -> Result<agent_cli::managed_config::CliConfigManagedStatus, String> {
    use agent_cli::managed_config::{desktop::CredentialHelper, DirectConnection};

    if model.is_empty() || model.len() > 256 || !models.iter().any(|entry| entry.id == model) {
        return Err("Unsupported Desktop selection".into());
    }
    let source =
        crate::dynamic_credentials::source(&key)?.ok_or("Dynamic credential source required")?;
    source.credential(&key, "claude_desktop").await?;
    ensure_managed_proxy_running().await?;
    let authorization = authorization.await?;
    tokio::task::spawn_blocking(move || {
        authorization.check()?;
        if !PROXY_RUNNING.load(Ordering::SeqCst) {
            return Err(proxy_unavailable_message());
        }
        let token = agent_cli::managed_config::generate_proxy_token();
        let profile = native_app.ok_or("Official Claude App requires an isolated profile")?;
        let helper_path = profile.helper();
        let base_url = agent_cli::managed_config::claude_desktop_proxy_base_url(
            &agent_cli::managed_config::managed_proxy_url(),
            &token,
        );
        let connection = DirectConnection {
            profile: None,
            key_id: key,
            provider: "market".into(),
            model,
            base_url,
            api_key: String::new(),
            desktop_auth_scheme: Some("bearer".into()),
            desktop_helper: Some(CredentialHelper {
                path: helper_path.clone(),
                token: token.clone(),
                models,
            }),
            proxy_token: Some(token),
        };
        let status = agent_cli::managed_config::enable_native_app(
            &profile,
            connection.key_id.clone(),
            connection.provider.clone(),
            connection.model.clone(),
            None,
            Some(&connection),
            &expected_hashes,
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&helper_path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not activate the Desktop credential helper")?;
        }
        Ok(status)
    })
    .await
    .map_err(|_| "Desktop configuration task failed")?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_enable_orgii_managed(
    agent_name: String,
    key_id: Option<String>,
    model: Option<String>,
    force: bool,
    expected_hashes: Option<std::collections::BTreeMap<String, Option<String>>>,
) -> Result<agent_cli::managed_config::CliConfigManagedStatus, String> {
    crate::harness_connections::authorize_managed(
        &agent_name,
        key_id.as_deref(),
        model.as_deref(),
    )?;
    ensure_managed_proxy_running().await?;
    tokio::task::spawn_blocking(move || {
        if !PROXY_RUNNING.load(Ordering::SeqCst) {
            return Err(proxy_unavailable_message());
        }
        crate::harness_connections::authorize_managed(
            &agent_name,
            key_id.as_deref(),
            model.as_deref(),
        )?;
        let context = resolve_proxy_context_for_selection(
            &agent_name,
            key_id.as_deref(),
            model.as_deref(),
            String::new(),
        )?;
        agent_cli::managed_config::enable_orgii_managed_checked(
            &agent_name,
            Some(context.key_id),
            Some(context.provider),
            Some(context.model),
            force,
            expected_hashes.as_ref(),
        )
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_managed_proxy_status(agent_name: String) -> Result<CliManagedProxyStatus, String> {
    let running = PROXY_RUNNING.load(Ordering::SeqCst);
    let url = agent_cli::managed_config::managed_proxy_url();

    if let Err(reason) = protocol_for_agent(&agent_name) {
        return Ok(CliManagedProxyStatus {
            agent_name,
            supported: false,
            running,
            ready: false,
            url,
            selected_key_id: None,
            selected_provider: None,
            selected_model: None,
            upstream_base_url: None,
            compatible_key_ids: Vec::new(),
            message: Some(reason),
        });
    }

    let compatible_key_ids = compatible_key_ids_for_agent(&agent_name);

    match resolve_proxy_context(&agent_name) {
        Ok(context) => {
            let message = if running {
                None
            } else {
                Some(proxy_unavailable_message())
            };
            Ok(CliManagedProxyStatus {
                agent_name,
                supported: true,
                running,
                ready: running,
                url,
                selected_key_id: Some(context.key_id),
                selected_provider: Some(context.provider),
                selected_model: Some(context.model),
                upstream_base_url: Some(context.upstream_base_url),
                compatible_key_ids: compatible_key_ids.clone(),
                message,
            })
        }
        Err(err) => {
            let selection = agent_cli::managed_config::managed_selection_for_agent(&agent_name)?;
            let message = if running {
                err
            } else {
                format!("{}; {err}", proxy_unavailable_message())
            };
            Ok(CliManagedProxyStatus {
                agent_name,
                supported: true,
                running,
                ready: false,
                url,
                selected_key_id: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_key_id.clone()),
                selected_provider: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_provider.clone()),
                selected_model: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_model.clone()),
                upstream_base_url: None,
                compatible_key_ids,
                message: Some(message),
            })
        }
    }
}

fn json_error(status: StatusCode, message: String) -> Response<Body> {
    let body = serde_json::json!({
        "error": {
            "message": message,
            "type": "orgii_cli_managed_proxy_error",
        }
    });

    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::from("proxy error")))
}

/// Revoke only this live session route; never change another client's selection.
pub(crate) fn release_session_route(session_id: &str) -> Result<(), String> {
    session_routes::release(session_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(feature = "market-connect")]
    #[tokio::test]
    async fn codex_router_forwards_workspace_v1_uri_and_query_to_upstream() {
        crate::test_utils::install_crypto_provider_for_tests();
        let (observed, mut received) = tokio::sync::mpsc::channel(4);
        let upstream = Router::new().fallback(any(move |request: Request<Body>| {
            let observed = observed.clone();
            async move {
                let uri = request.uri().to_string();
                let auth = request
                    .headers()
                    .get("authorization")
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned();
                let bytes = to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES)
                    .await
                    .unwrap();
                let payload: Value = serde_json::from_slice(&bytes).unwrap();
                observed.send((uri, auth, payload)).await.unwrap();
                Json(json!({"ok":true}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_root = format!("http://{}/w/ws_route_test", listener.local_addr().unwrap());
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let context = ProxyContext {
            authentication: Authentication::Bearer,
            key_id: "test-static-selection".into(),
            provider: "market".into(),
            model: "test-model".into(),
            api_key: "synthetic-bearer".into(),
            upstream_base_url: crate::market_connection::source::protocol_base_url(
                &upstream_root,
                "codex",
            ),
            proxy_token: "synthetic-local-token".into(),
            protocol: ProxyProtocol::OpenAi,
        };
        let app = proxy_router(ContextResolver(std::sync::Arc::new(move |agent| {
            assert_eq!(agent, "codex");
            Ok(context.clone())
        })));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_url = format!("http://{}", listener.local_addr().unwrap());
        let proxy_task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = reqwest::Client::new();
        for (path, requested, expected) in [
            ("responses", "orgii-current-model", "test-model"),
            ("responses?stream=true", "second-model", "second-model"),
            ("responses", "third-model", "third-model"),
        ] {
            let response = client
                .post(format!(
                    "{proxy_url}/cli/codex/synthetic-local-token/v1/{path}"
                ))
                .json(&json!({"model":requested,"input":"test"}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let (uri, auth, payload) =
                tokio::time::timeout(Duration::from_secs(5), received.recv())
                    .await
                    .unwrap()
                    .unwrap();
            assert_eq!(uri, format!("/w/ws_route_test/v1/{path}"));
            assert_eq!(auth, "Bearer synthetic-bearer");
            assert_eq!(payload["model"], expected);
        }
        let rejected = client
            .post(format!("{proxy_url}/cli/codex/wrong-token/v1/responses"))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
        assert!(received.try_recv().is_err());
        proxy_task.abort();
        upstream_task.abort();
    }

    #[tokio::test]
    async fn session_routes_forward_independently_and_reject_released_tokens() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let (observed, mut received) = tokio::sync::mpsc::channel(8);
        let upstream = Router::new().fallback(any(move |request: Request<Body>| {
            let observed = observed.clone();
            async move {
                observed.send(request.uri().to_string()).await.unwrap();
                Json(json!({"ok":true}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let sessions = [
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
        ];
        let mut tokens = Vec::new();
        for (index, session) in sessions.iter().enumerate() {
            tokens.push(
                session_routes::reserve(
                    session,
                    "codex",
                    ProxyContext {
                        authentication: Authentication::Bearer,
                        key_id: "test-static".into(),
                        provider: "test".into(),
                        model: "test-model".into(),
                        upstream_base_url: format!("{root}/w/ws_{index}/v1"),
                        api_key: "synthetic-upstream-key".into(),
                        proxy_token: String::new(),
                        protocol: ProxyProtocol::OpenAi,
                    },
                )
                .unwrap(),
            );
        }
        // Session routes remain usable without a global selection.
        let app = proxy_router(ContextResolver(std::sync::Arc::new(|_| {
            Err("global selection removed".into())
        })));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_url = format!("http://{}", listener.local_addr().unwrap());
        let proxy_task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = reqwest::Client::new();
        for index in [0, 1, 0] {
            let response = client
                .post(format!(
                    "{proxy_url}/cli/codex/{}/v1/responses",
                    tokens[index]
                ))
                .json(&json!({"model":"orgii-current-model","input":"test"}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(5), received.recv())
                    .await
                    .unwrap()
                    .unwrap(),
                format!("/w/ws_{index}/v1/responses")
            );
        }
        session_routes::release(&sessions[0]).unwrap();
        let rejected = client
            .post(format!("{proxy_url}/cli/codex/{}/v1/responses", tokens[0]))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::PRECONDITION_FAILED);
        assert!(received.try_recv().is_err());
        let remaining = client
            .post(format!("{proxy_url}/cli/codex/{}/v1/responses", tokens[1]))
            .json(&json!({"model":"test-model","input":"test"}))
            .send()
            .await
            .unwrap();
        assert_eq!(remaining.status(), StatusCode::OK);
        session_routes::release(&sessions[1]).unwrap();
        let claude_session = uuid::Uuid::new_v4().to_string();
        let claude_token = session_routes::reserve(
            &claude_session,
            "claude_code",
            ProxyContext {
                authentication: Authentication::Bearer,
                key_id: "test-static".into(),
                provider: "test".into(),
                model: "test-model".into(),
                upstream_base_url: format!("{root}/w/ws_claude"),
                api_key: "synthetic-upstream-key".into(),
                proxy_token: String::new(),
                protocol: ProxyProtocol::Anthropic,
            },
        )
        .unwrap();
        let head_url = format!("{proxy_url}/cli/claude_code/{claude_token}/claude/v1");
        assert_eq!(
            client.head(&head_url).send().await.unwrap().status(),
            StatusCode::OK
        );
        let response = client
            .post(format!("{head_url}/messages"))
            .json(&json!({"model":"test-model","messages":[],"max_tokens":1}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        // Drain the preceding surviving Codex request, then the Claude request.
        assert_eq!(received.recv().await.unwrap(), "/w/ws_1/v1/responses");
        assert_eq!(received.recv().await.unwrap(), "/w/ws_claude/v1/messages");
        session_routes::release(&claude_session).unwrap();
        assert_eq!(
            client.head(&head_url).send().await.unwrap().status(),
            StatusCode::PRECONDITION_FAILED
        );
        assert!(received.try_recv().is_err());
        proxy_task.abort();
        upstream_task.abort();
    }

    #[test]
    fn rewrites_placeholder_model() {
        let mut value = json!({
            "model": ORGII_CURRENT_MODEL,
            "input": "hello"
        });

        rewrite_model_field(&mut value, "gpt-5.1");

        assert_eq!(value["model"], "gpt-5.1");
    }

    #[test]
    fn inserts_missing_model() {
        let mut value = json!({
            "input": "hello"
        });

        rewrite_model_field(&mut value, "gpt-5.1");

        assert_eq!(value["model"], "gpt-5.1");
    }

    #[test]
    fn managed_adapter_protocols_drive_proxy_capabilities() {
        let codex = protocol_for_agent("codex").unwrap();
        assert!(matches!(codex.protocol, ProxyProtocol::OpenAi));
        assert!(codex.requires_openai_responses);

        let opencode = protocol_for_agent("opencode").unwrap();
        assert!(matches!(opencode.protocol, ProxyProtocol::OpenAi));
        assert!(!opencode.requires_openai_responses);

        let aider = protocol_for_agent("aider").unwrap();
        assert!(matches!(aider.protocol, ProxyProtocol::OpenAi));
        assert!(!aider.requires_openai_responses);
    }

    #[test]
    fn proxy_retry_delay_is_exponential_and_capped() {
        assert_eq!(proxy_retry_delay_secs(1), 1);
        assert_eq!(proxy_retry_delay_secs(2), 2);
        assert_eq!(proxy_retry_delay_secs(3), 4);
        assert_eq!(proxy_retry_delay_secs(5), 16);
        assert_eq!(proxy_retry_delay_secs(6), 30);
        assert_eq!(proxy_retry_delay_secs(20), 30);
    }

    #[test]
    fn builds_upstream_url_without_double_slashes() {
        assert_eq!(
            build_upstream_url("https://api.openai.com/v1/", "/responses").unwrap(),
            "https://api.openai.com/v1/responses"
        );
    }

    #[test]
    fn upstream_url_preserves_base_and_incoming_queries() {
        assert_eq!(
            build_upstream_url(
                "https://example.test/openai?api-version=2026-01-01",
                "responses?stream=true"
            )
            .unwrap(),
            "https://example.test/openai/responses?api-version=2026-01-01&stream=true"
        );
    }

    #[test]
    fn builds_anthropic_upstream_url_without_double_v1() {
        assert_eq!(
            build_anthropic_upstream_url("https://api.anthropic.com/v1", "v1/messages").unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            build_anthropic_upstream_url("https://zenmux.ai/api/anthropic", "v1/messages").unwrap(),
            "https://zenmux.ai/api/anthropic/v1/messages"
        );
    }

    #[test]
    fn proxy_token_check_rejects_missing_or_modified_tokens() {
        assert!(proxy_token_matches("abc123", "abc123"));
        assert!(!proxy_token_matches("abc123", "abc124"));
        assert!(!proxy_token_matches("abc123", "abc12"));
    }

    #[test]
    fn proxy_forwards_query_parameters() {
        assert_eq!(
            forwarded_query(&ProxyProtocol::OpenAi, Some("api-version=2026-01-01")),
            Some("api-version=2026-01-01".to_string())
        );
    }
    #[test]
    fn protocol_default_preserves_static_provider_authentication() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        for (protocol, provider, header, expected) in [
            (
                ProxyProtocol::Anthropic,
                "anthropic",
                "x-api-key",
                "fixture-key",
            ),
            (
                ProxyProtocol::Anthropic,
                "azure_anthropic_api",
                "api-key",
                "fixture-key",
            ),
            (
                ProxyProtocol::OpenAi,
                "openai",
                "authorization",
                "Bearer fixture-key",
            ),
            (
                ProxyProtocol::OpenAi,
                "azure_openai_api",
                "api-key",
                "fixture-key",
            ),
        ] {
            let request = apply_auth_header(
                client.post("https://gateway.example.test"),
                &protocol,
                provider,
                "fixture-key",
                Authentication::ProtocolDefault,
            )
            .build()
            .unwrap();
            assert_eq!(request.headers().get(header).unwrap(), expected);
            for other in ["authorization", "x-api-key", "api-key"] {
                if other != header {
                    assert!(!request.headers().contains_key(other));
                }
            }
        }
    }

    #[test]
    fn dynamic_source_declares_bearer_for_both_protocols() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        for protocol in [ProxyProtocol::Anthropic, ProxyProtocol::OpenAi] {
            let request = apply_auth_header(
                client.post("https://gateway.example.test/w/ws_fixture/v1/messages"),
                &protocol,
                "test-source",
                "synthetic-workspace-token",
                Authentication::Bearer,
            )
            .build()
            .unwrap();
            assert_eq!(
                request.headers().get("authorization").unwrap(),
                "Bearer synthetic-workspace-token"
            );
            assert!(!request.headers().contains_key("x-api-key"));
            assert!(!request.headers().contains_key("api-key"));
        }
        assert_eq!(
            build_anthropic_upstream_url(
                "https://gateway.example.test/w/ws_fixture",
                "v1/messages"
            )
            .unwrap(),
            "https://gateway.example.test/w/ws_fixture/v1/messages"
        );
        assert_eq!(
            build_upstream_url("https://gateway.example.test/w/ws_fixture", "v1/responses")
                .unwrap(),
            "https://gateway.example.test/w/ws_fixture/v1/responses"
        );
    }
}

#[cfg(all(test, feature = "market-connect"))]
#[path = "cli_managed_proxy/catalog_tests.rs"]
mod catalog_tests;
