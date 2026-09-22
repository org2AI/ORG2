//! Blocking Git work runs off the async server executor. Dropped HTTP clients do
//! not cancel an operation between snapshotting and checkout/apply.
use crate::{
    commands::branch_switch as switch,
    error::{GitApiError, GitApiResult},
    extractors::{lookup_repo_path, validate_path},
};
use axum::{
    extract::{Path, Query},
    routing::post,
    Json, Router,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Scope {
    path: Option<String>,
}

pub fn routes() -> Router {
    Router::new()
        .route(
            "/api/git/repo/{repo_id}/branch-switch/prepare",
            post(prepare),
        )
        .route(
            "/api/git/repo/{repo_id}/branch-switch/execute",
            post(execute),
        )
}

async fn run<T: serde::Serialize + Send + 'static>(
    repo_id: String,
    scope: Scope,
    f: impl FnOnce(std::path::PathBuf) -> Result<T, String> + Send + 'static,
) -> GitApiResult<Json<serde_json::Value>> {
    let path = match scope.path {
        Some(path) => validate_path(&path)?,
        None => lookup_repo_path(&repo_id)?,
    };
    let data = tokio::task::spawn_blocking(move || f(path))
        .await
        .map_err(|e| GitApiError::Internal {
            message: e.to_string(),
        })?
        .map_err(GitApiError::from_git_error)?;
    Ok(Json(serde_json::json!({ "status": 0, "data": data })))
}
async fn prepare(
    Path(id): Path<String>,
    Query(scope): Query<Scope>,
    Json(target): Json<switch::SwitchTarget>,
) -> GitApiResult<Json<serde_json::Value>> {
    run(id, scope, move |p| switch::prepare(&p, &target)).await
}
async fn execute(
    Path(id): Path<String>,
    Query(scope): Query<Scope>,
    Json(req): Json<switch::ExecuteRequest>,
) -> GitApiResult<Json<serde_json::Value>> {
    run(id, scope, move |p| switch::execute(&p, req)).await
}
