use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use integrations::cli_binary_resolver::{
    probe_cli_binary_version, resolve_cli_binary_for_registry_name,
};

const VERSION_CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const LATEST_VERSION_TIMEOUT: Duration = Duration::from_secs(5);

const SUPPORTED_VERSION_SCANS: &[&str] = &[
    "cursor_cli",
    "claude_code",
    "codex",
    "copilot",
    "kiro",
    "kimi_cli",
    "opencode",
    "aider",
    "goose",
    "amp",
    "cline",
    "kilo",
    "grok_cli",
    "devin",
    "rovo",
    "hermes",
    "openclaw",
    "aug",
    "codebuff",
    "qwen_code",
    "mimo_code",
    "antigravity",
    "continue_cli",
    "droid",
    "mistral_vibe",
    "autohand",
    "omp",
    "pi",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliVersionStatus {
    Current,
    Outdated,
    Unknown,
}

/// Read-only version observation for one user-selected CLI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CliVersionSnapshot {
    pub agent_type: String,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub installed_version_error: Option<String>,
    pub latest_version_error: Option<String>,
    pub status: CliVersionStatus,
    pub scanned_at: DateTime<Utc>,
    pub stale: bool,
}

#[derive(Debug, Clone)]
struct CachedVersionSnapshot {
    captured_at: Instant,
    snapshot: CliVersionSnapshot,
}

static VERSION_CACHE: LazyLock<Mutex<HashMap<String, CachedVersionSnapshot>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, PartialEq, Eq)]
struct LatestVersionProbe {
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum LatestVersionSource {
    Npm(&'static str),
    GithubRelease(&'static str),
    JsonManifest(&'static str),
    AntigravityManifest,
    InstallerScript {
        url: &'static str,
        version_prefix: &'static str,
    },
}

#[derive(Debug, Deserialize)]
struct VersionResponse {
    version: String,
}

#[derive(Debug, Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
}

fn source_for(agent_type: &str) -> Option<LatestVersionSource> {
    match agent_type {
        "cursor_cli" => Some(LatestVersionSource::InstallerScript {
            url: "https://cursor.com/install",
            version_prefix: "/versions/",
        }),
        "claude_code" => Some(LatestVersionSource::Npm("@anthropic-ai/claude-code")),
        "codex" => Some(LatestVersionSource::Npm("@openai/codex")),
        "copilot" => Some(LatestVersionSource::Npm("@github/copilot")),
        "kiro" => Some(LatestVersionSource::JsonManifest(
            "https://prod.download.cli.kiro.dev/stable/latest/manifest.json",
        )),
        "kimi_cli" => Some(LatestVersionSource::GithubRelease("MoonshotAI/kimi-cli")),
        "opencode" => Some(LatestVersionSource::GithubRelease("anomalyco/opencode")),
        "aider" => Some(LatestVersionSource::GithubRelease("Aider-AI/aider")),
        "goose" => Some(LatestVersionSource::GithubRelease("block/goose")),
        "amp" => Some(LatestVersionSource::Npm("@ampcode/cli")),
        "cline" => Some(LatestVersionSource::Npm("cline")),
        "kilo" => Some(LatestVersionSource::Npm("@kilocode/cli")),
        "grok_cli" => Some(LatestVersionSource::Npm("grok-cli")),
        "openclaw" => Some(LatestVersionSource::Npm("openclaw")),
        "aug" => Some(LatestVersionSource::Npm("@augmentcode/auggie")),
        "codebuff" => Some(LatestVersionSource::Npm("codebuff")),
        "qwen_code" => Some(LatestVersionSource::GithubRelease("QwenLM/qwen-code")),
        "mimo_code" => Some(LatestVersionSource::Npm("@mimo-ai/cli")),
        "antigravity" => Some(LatestVersionSource::AntigravityManifest),
        "continue_cli" => Some(LatestVersionSource::Npm("@continuedev/cli")),
        "droid" => Some(LatestVersionSource::Npm("droid")),
        "mistral_vibe" => Some(LatestVersionSource::GithubRelease("mistralai/mistral-vibe")),
        "autohand" => Some(LatestVersionSource::Npm("autohand-cli")),
        "omp" => Some(LatestVersionSource::Npm("@oh-my-pi/pi-coding-agent")),
        "pi" => Some(LatestVersionSource::Npm("@earendil-works/pi-coding-agent")),
        // These clients have no configured stable, read-only latest-version
        // endpoint. Unknown results never block a session or invoke an updater.
        "devin" | "rovo" | "hermes" => None,
        _ => None,
    }
}

fn cache_entry_is_fresh(entry: &CachedVersionSnapshot) -> bool {
    entry.captured_at.elapsed() < VERSION_CACHE_TTL
}

fn public_snapshot(entry: &CachedVersionSnapshot) -> CliVersionSnapshot {
    let mut snapshot = entry.snapshot.clone();
    snapshot.stale = !cache_entry_is_fresh(entry);
    snapshot
}

/// Scan the installed and latest versions of exactly one selected CLI.
///
/// Non-forced calls reuse a compact in-memory snapshot for twelve hours. The scan
/// never reads credentials, mutates the CLI, or writes to Key Vault.
#[tauri::command]
pub async fn scan_cli_version(
    agent_type: String,
    force: Option<bool>,
) -> Result<CliVersionSnapshot, String> {
    if !SUPPORTED_VERSION_SCANS.contains(&agent_type.as_str()) {
        return Err(format!(
            "CLI version scan is not supported for {agent_type:?}"
        ));
    }

    {
        let cache = VERSION_CACHE.lock().await;
        if force != Some(true) {
            if let Some(entry) = cache
                .get(&agent_type)
                .filter(|entry| cache_entry_is_fresh(entry))
            {
                return Ok(public_snapshot(entry));
            }
        }
    }

    let resolution = resolve_cli_binary_for_registry_name(&agent_type)
        .ok_or_else(|| format!("CLI binary metadata is missing for {agent_type:?}"))?;
    let (installed, latest) = tokio::join!(
        probe_cli_binary_version(&resolution),
        probe_latest_cli_version(&agent_type)
    );
    let status = version_status(installed.version.as_deref(), latest.version.as_deref());
    let snapshot = CliVersionSnapshot {
        agent_type: agent_type.clone(),
        installed_version: installed.version,
        latest_version: latest.version,
        installed_version_error: installed.error,
        latest_version_error: latest.error,
        status,
        scanned_at: Utc::now(),
        stale: false,
    };
    VERSION_CACHE.lock().await.insert(
        agent_type,
        CachedVersionSnapshot {
            captured_at: Instant::now(),
            snapshot: snapshot.clone(),
        },
    );
    Ok(snapshot)
}

async fn probe_latest_cli_version(agent_type: &str) -> LatestVersionProbe {
    let Some(source) = source_for(agent_type) else {
        return LatestVersionProbe {
            version: None,
            error: Some("No trusted latest-version source is configured for this CLI".to_string()),
        };
    };

    let client = match reqwest::Client::builder()
        .timeout(LATEST_VERSION_TIMEOUT)
        .user_agent("ORGII CLI version scanner")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return LatestVersionProbe {
                version: None,
                error: Some(format!(
                    "Latest-version client could not be created: {error}"
                )),
            };
        }
    };

    let result = match source {
        LatestVersionSource::Npm(package) => {
            let encoded = urlencoding::encode(package);
            let url = format!("https://registry.npmjs.org/{encoded}/latest");
            fetch_json::<VersionResponse>(&client, &url)
                .await
                .map(|response| response.version)
        }
        LatestVersionSource::GithubRelease(repo) => {
            let url = format!("https://api.github.com/repos/{repo}/releases/latest");
            fetch_json::<GithubLatestRelease>(&client, &url)
                .await
                .map(|response| response.tag_name)
        }
        LatestVersionSource::JsonManifest(url) => fetch_json::<VersionResponse>(&client, url)
            .await
            .map(|response| response.version),
        LatestVersionSource::AntigravityManifest => match antigravity_manifest_url() {
            Ok(url) => fetch_json::<VersionResponse>(&client, &url)
                .await
                .map(|response| response.version),
            Err(error) => Err(error),
        },
        LatestVersionSource::InstallerScript {
            url,
            version_prefix,
        } => fetch_text(&client, url)
            .await
            .and_then(|body| version_after_prefix(&body, version_prefix)),
    };

    match result.and_then(|raw| {
        normalize_version(&raw).ok_or_else(|| {
            format!("Latest-version response contained no comparable version: {raw}")
        })
    }) {
        Ok(version) => LatestVersionProbe {
            version: Some(version),
            error: None,
        },
        Err(error) => LatestVersionProbe {
            version: None,
            error: Some(error),
        },
    }
}

fn antigravity_manifest_url() -> Result<String, String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        unsupported => {
            return Err(format!(
                "No Antigravity release manifest is configured for {unsupported}"
            ));
        }
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        unsupported => {
            return Err(format!(
                "No Antigravity release manifest is configured for {unsupported}"
            ));
        }
    };
    let libc_suffix = if os == "linux" && cfg!(target_env = "musl") {
        "_musl"
    } else {
        ""
    };
    Ok(format!(
        "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/{os}_{arch}{libc_suffix}.json"
    ))
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Latest-version request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Latest-version endpoint returned an error: {error}"))?;
    response
        .json::<T>()
        .await
        .map_err(|error| format!("Latest-version response was invalid: {error}"))
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Latest-version request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Latest-version endpoint returned an error: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Latest-version response was invalid: {error}"))
}

fn version_after_prefix(body: &str, prefix: &str) -> Result<String, String> {
    let Some(start) = body.find(prefix).map(|index| index + prefix.len()) else {
        return Err("Latest-version installer response did not expose a version".to_string());
    };
    let raw = body[start..]
        .chars()
        .take_while(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        .collect::<String>();
    if raw.is_empty() {
        Err("Latest-version installer response exposed an empty version".to_string())
    } else {
        Ok(raw)
    }
}

fn normalize_version(raw: &str) -> Option<String> {
    let start = raw.find(|character: char| character.is_ascii_digit())?;
    let normalized = raw[start..]
        .chars()
        .take_while(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '+')
        })
        .collect::<String>();
    (!normalized.is_empty()).then_some(normalized)
}

fn numeric_components(raw: &str) -> Option<Vec<u64>> {
    let normalized = normalize_version(raw)?;
    let core = normalized
        .split_once('-')
        .map(|(core, _)| core)
        .unwrap_or(&normalized);
    let components = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (components.len() >= 2).then_some(components)
}

fn compare_versions(installed: &str, latest: &str) -> Option<Ordering> {
    let installed = numeric_components(installed)?;
    let latest = numeric_components(latest)?;
    for index in 0..installed.len().max(latest.len()) {
        match installed
            .get(index)
            .copied()
            .unwrap_or_default()
            .cmp(&latest.get(index).copied().unwrap_or_default())
        {
            Ordering::Equal => continue,
            ordering => return Some(ordering),
        }
    }
    Some(Ordering::Equal)
}

fn version_status(installed: Option<&str>, latest: Option<&str>) -> CliVersionStatus {
    match (installed, latest) {
        (Some(installed), Some(latest)) => match compare_versions(installed, latest) {
            Some(Ordering::Less) => CliVersionStatus::Outdated,
            Some(Ordering::Equal | Ordering::Greater) => CliVersionStatus::Current,
            None => CliVersionStatus::Unknown,
        },
        _ => CliVersionStatus::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn droid_checks_the_package_used_by_its_installer() {
        assert!(matches!(
            source_for("droid"),
            Some(LatestVersionSource::Npm("droid"))
        ));
    }

    #[test]
    fn normalizes_release_tags_and_installer_paths() {
        assert_eq!(normalize_version("rust-v0.143.0"), Some("0.143.0".into()));
        assert_eq!(
            version_after_prefix(
                "FINAL_DIR=\"$HOME/.local/share/cursor-agent/versions/2026.07.16-899851b\"",
                "/versions/"
            ),
            Ok("2026.07.16-899851b".into())
        );
    }

    #[test]
    fn compares_numeric_version_components() {
        assert_eq!(compare_versions("0.143.0", "0.144.0"), Some(Ordering::Less));
        assert_eq!(compare_versions("2.1.78", "v2.1.78"), Some(Ordering::Equal));
        assert_eq!(
            compare_versions("2026.07.16-abc", "2026.07.15-def"),
            Some(Ordering::Greater)
        );
    }

    #[test]
    fn marks_only_known_older_versions_as_outdated() {
        assert_eq!(
            version_status(Some("0.143.0"), Some("0.144.0")),
            CliVersionStatus::Outdated
        );
        assert_eq!(
            version_status(Some("0.144.0"), Some("0.144.0")),
            CliVersionStatus::Current
        );
        assert_eq!(
            version_status(Some("development"), Some("0.144.0")),
            CliVersionStatus::Unknown
        );
    }

    #[test]
    fn scan_cache_lives_for_twelve_hours() {
        assert_eq!(VERSION_CACHE_TTL, Duration::from_secs(12 * 60 * 60));
    }
}
