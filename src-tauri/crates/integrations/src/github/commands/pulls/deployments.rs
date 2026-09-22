use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;
use tauri::command;

use super::super::shared::make_client;

/// Environments GitHub lists for one branch before it stops being a summary.
const MAX_ENVIRONMENTS: usize = 10;

/// Latest deployment of a branch to one environment, with its latest status.
/// Mirrors `GET /repos/{repo}/deployments` + `/deployments/{id}/statuses`.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct GitHubDeployment {
    pub id: u64,
    pub environment: String,
    /// success | failure | error | inactive | in_progress | queued | pending.
    /// `pending` when GitHub has not reported a status yet.
    pub state: String,
    pub description: Option<String>,
    pub environment_url: Option<String>,
    pub log_url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Deployments view for a PR head branch. `repo_has_deployments` separates
/// "this repo deploys, this branch has not been" from "this repo never
/// deploys", which GitHub's merge box shows as no section at all.
#[derive(Debug, Serialize)]
pub struct GitHubDeploymentsSummary {
    pub git_ref: String,
    pub repo_has_deployments: bool,
    pub deployments: Vec<GitHubDeployment>,
}

/// The newest deployment per environment, in the order GitHub returned them
/// (newest first). Older deployments to the same environment are superseded.
pub(crate) fn latest_per_environment(deployments: &[Value]) -> Vec<&Value> {
    let mut seen = HashSet::new();
    deployments
        .iter()
        .filter(|deployment| {
            let environment = deployment["environment"].as_str().unwrap_or("");
            !environment.is_empty() && seen.insert(environment.to_string())
        })
        .take(MAX_ENVIRONMENTS)
        .collect()
}

pub(crate) fn parse_deployment(deployment: &Value, latest_status: &Value) -> GitHubDeployment {
    let non_empty = |value: &Value| {
        value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(String::from)
    };
    GitHubDeployment {
        id: deployment["id"].as_u64().unwrap_or(0),
        environment: deployment["environment"].as_str().unwrap_or("").to_string(),
        state: latest_status["state"]
            .as_str()
            .unwrap_or("pending")
            .to_string(),
        description: non_empty(&latest_status["description"]),
        environment_url: non_empty(&latest_status["environment_url"]),
        log_url: non_empty(&latest_status["log_url"]),
        created_at: deployment["created_at"].as_str().map(String::from),
        updated_at: latest_status["created_at"]
            .as_str()
            .or_else(|| deployment["updated_at"].as_str())
            .map(String::from),
    }
}

/// Deployments of a PR head branch (`git_ref`), newest per environment.
///
/// A repo without deployments, or a token that cannot read them, answers with
/// an empty summary rather than an error: the section is optional chrome and
/// must never fail the PR detail load.
#[command]
pub async fn github_get_deployments(
    repo_full_name: String,
    git_ref: String,
) -> Result<GitHubDeploymentsSummary, String> {
    log::info!("[GitHub][Cmd] get_deployments repo={repo_full_name} ref={git_ref}");
    let client = make_client()?;
    let encoded_ref = urlencoding::encode(&git_ref);

    let branch_deployments = match client
        .get_conditional(&format!(
            "/repos/{repo_full_name}/deployments?ref={encoded_ref}&per_page=30"
        ))
        .await
    {
        Ok(value) => value.as_array().cloned().unwrap_or_default(),
        Err(err) if err.contains("GitHubReAuthRequired") => return Err(err),
        Err(err) => {
            log::warn!("[GitHub][Cmd] get_deployments list failed: {err}");
            Vec::new()
        }
    };

    let mut deployments = Vec::new();
    for deployment in latest_per_environment(&branch_deployments) {
        let id = deployment["id"].as_u64().unwrap_or(0);
        let latest_status = match client
            .get_conditional(&format!(
                "/repos/{repo_full_name}/deployments/{id}/statuses?per_page=1"
            ))
            .await
        {
            Ok(value) => value
                .as_array()
                .and_then(|statuses| statuses.first().cloned())
                .unwrap_or(Value::Null),
            Err(err) if err.contains("GitHubReAuthRequired") => return Err(err),
            Err(err) => {
                log::warn!("[GitHub][Cmd] get_deployments statuses failed: {err}");
                Value::Null
            }
        };
        deployments.push(parse_deployment(deployment, &latest_status));
    }

    let repo_has_deployments = if deployments.is_empty() {
        match client
            .get_conditional(&format!("/repos/{repo_full_name}/deployments?per_page=1"))
            .await
        {
            Ok(value) => value.as_array().is_some_and(|items| !items.is_empty()),
            Err(err) if err.contains("GitHubReAuthRequired") => return Err(err),
            Err(_) => false,
        }
    } else {
        true
    };

    Ok(GitHubDeploymentsSummary {
        git_ref,
        repo_has_deployments,
        deployments,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn keeps_only_the_newest_deployment_of_each_environment() {
        let deployments = vec![
            json!({ "id": 3, "environment": "production" }),
            json!({ "id": 2, "environment": "preview" }),
            json!({ "id": 1, "environment": "production" }),
            json!({ "id": 0, "environment": "" }),
        ];
        let ids: Vec<u64> = latest_per_environment(&deployments)
            .iter()
            .map(|deployment| deployment["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![3, 2]);
    }

    #[test]
    fn reads_state_and_links_from_the_latest_status() {
        let deployment = json!({
            "id": 7,
            "environment": "production",
            "created_at": "2026-09-20T00:00:00Z",
            "updated_at": "2026-09-20T00:00:01Z",
        });
        let status = json!({
            "state": "success",
            "description": "",
            "environment_url": "https://example.com",
            "log_url": "https://example.com/log",
            "created_at": "2026-09-20T00:05:00Z",
        });
        assert_eq!(
            parse_deployment(&deployment, &status),
            GitHubDeployment {
                id: 7,
                environment: "production".to_string(),
                state: "success".to_string(),
                description: None,
                environment_url: Some("https://example.com".to_string()),
                log_url: Some("https://example.com/log".to_string()),
                created_at: Some("2026-09-20T00:00:00Z".to_string()),
                updated_at: Some("2026-09-20T00:05:00Z".to_string()),
            }
        );
    }

    #[test]
    fn reports_pending_until_github_posts_a_status() {
        let deployment = json!({ "id": 7, "environment": "preview" });
        assert_eq!(parse_deployment(&deployment, &Value::Null).state, "pending");
    }
}
