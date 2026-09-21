//! On-demand bounded workspace review. No writes, external diff drivers or shell.
use crate::api::mobile_bridge::rpc::RpcError;
use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::AsyncReadExt;

const BUDGET: u64 = 512 * 1024;

async fn git(root: &Path, args: &[&str]) -> Result<String, RpcError> {
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let mut child = tokio::process::Command::new("git")
            .arg("--literal-pathspecs")
            .args(args)
            .current_dir(root)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| RpcError::invalid_params("git unavailable"))?;
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(|| RpcError::invalid_params("git output unavailable"))?
            .take(BUDGET + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| RpcError::invalid_params("git read failed"))?;
        if bytes.len() > BUDGET as usize {
            return Err(RpcError::invalid_params(
                "workspace change exceeds preview budget",
            ));
        }
        if !child
            .wait()
            .await
            .map_err(|_| RpcError::invalid_params("git wait failed"))?
            .success()
        {
            return Err(RpcError::invalid_params("workspace git query failed"));
        }
        String::from_utf8(bytes).map_err(|_| RpcError::invalid_params("binary content unavailable"))
    })
    .await;
    result.map_err(|_| RpcError::invalid_params("workspace query timed out"))?
}

pub(super) async fn read(session_id: &str, selected: Option<&str>) -> Result<Value, RpcError> {
    let id = session_id.to_owned();
    let root =
        tokio::task::spawn_blocking(move || super::file_navigation::session_workspace_root(&id))
            .await
            .map_err(|_| RpcError::invalid_params("workspace lookup failed"))??;
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| RpcError::invalid_params("workspace unavailable"))?;
    read_at(&root, selected).await
}

async fn read_at(root: &Path, selected: Option<&str>) -> Result<Value, RpcError> {
    let status = git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .await?;
    let mut entries = status.split('\0').filter(|entry| !entry.is_empty());
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 || !entry.is_char_boundary(3) {
            return Err(RpcError::invalid_params("invalid git status"));
        }
        let path = &entry[3..];
        let renamed = entry[..2].contains('R') || entry[..2].contains('C');
        let original = if renamed {
            entries
                .next()
                .ok_or_else(|| RpcError::invalid_params("invalid rename"))?
        } else {
            path
        };
        if files.len() >= 500 {
            return Err(RpcError::invalid_params("too many changed files"));
        }
        let mut file = json!({"path":path, "additions":null, "deletions":null, "patches":[], "before":null, "after":null, "availability":"current_workspace"});
        if selected == Some(path) {
            let candidate = root.join(path);
            if let Ok(canonical) = tokio::fs::canonicalize(&candidate).await {
                if !canonical.starts_with(root) {
                    return Err(RpcError::invalid_params("file outside workspace"));
                }
                let handle = tokio::fs::File::open(canonical)
                    .await
                    .map_err(|_| RpcError::invalid_params("file unavailable"))?;
                if handle
                    .metadata()
                    .await
                    .map_err(|_| RpcError::invalid_params("file unavailable"))?
                    .is_file()
                {
                    let mut bytes = Vec::new();
                    handle
                        .take(BUDGET + 1)
                        .read_to_end(&mut bytes)
                        .await
                        .map_err(|_| RpcError::invalid_params("file read failed"))?;
                    if bytes.len() <= BUDGET as usize && !bytes.contains(&0) {
                        if let Ok(text) = String::from_utf8(bytes) {
                            file["after"] = json!(text);
                        }
                    }
                }
            }
            if &entry[..2] != "??" {
                let spec = format!("HEAD:{original}");
                if let Ok(before) = git(root, &["show", &spec]).await {
                    if !before.contains('\0') {
                        file["before"] = json!(before);
                    }
                }
                if let Ok(patch) = git(
                    root,
                    &[
                        "diff",
                        "--no-ext-diff",
                        "--no-textconv",
                        "HEAD",
                        "--",
                        original,
                        path,
                    ],
                )
                .await
                {
                    if let Some((added, removed)) = super::change_review_stats::numstat(&patch) {
                        file["additions"] = json!(added);
                        file["deletions"] = json!(removed);
                    }
                    file["patches"] = json!([patch]);
                }
            } else if let Some(after) = file["after"].as_str() {
                let added = after.lines().count();
                file["additions"] = json!(added);
                file["deletions"] = json!(0);
                file["before"] = json!("");
            }
        }
        files.push(file);
    }
    Ok(json!({"files":files,"complete":true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_current_and_head_without_writes_and_rejects_external_symlink() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        git(&root, &["init"]).await.unwrap();
        std::fs::write(root.join("a file.ts"), "old\n").unwrap();
        git(&root, &["add", "a file.ts"]).await.unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        std::fs::write(root.join("a file.ts"), "new\n").unwrap();
        let before_status = git(&root, &["status", "--porcelain=v1", "-z"])
            .await
            .unwrap();
        let manifest = read_at(&root, None).await.unwrap();
        assert!(manifest["files"][0]["after"].is_null());
        let detail = read_at(&root, Some("a file.ts")).await.unwrap();
        assert_eq!(detail["files"][0]["before"], "old\n");
        assert_eq!(detail["files"][0]["after"], "new\n");
        assert_eq!(detail["files"][0]["additions"], 1);
        assert_eq!(detail["files"][0]["deletions"], 1);
        // The authoritative git boundary must distinguish a binary edit from
        // a zero-line text change, and preserve deleted/new file contents.
        std::fs::write(root.join("a file.ts"), b"binary\0payload").unwrap();
        let binary = read_at(&root, Some("a file.ts")).await.unwrap();
        assert!(binary["files"][0]["additions"].is_null());
        assert!(binary["files"][0]["after"].is_null());
        std::fs::remove_file(root.join("a file.ts")).unwrap();
        let deleted = read_at(&root, Some("a file.ts")).await.unwrap();
        assert_eq!(deleted["files"][0]["before"], "old\n");
        assert_eq!(deleted["files"][0]["deletions"], 1);
        assert!(deleted["files"][0]["after"].is_null());
        std::fs::write(root.join("new.ts"), "new file\n").unwrap();
        let new = read_at(&root, Some("new.ts")).await.unwrap();
        let new = new["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == "new.ts")
            .unwrap();
        assert_eq!(new["before"], "");
        assert_eq!(new["after"], "new file\n");
        assert_eq!(new["additions"], 1);
        std::fs::remove_file(root.join("new.ts")).unwrap();
        std::fs::write(root.join("a file.ts"), "new\n").unwrap();
        assert_eq!(
            before_status,
            git(&root, &["status", "--porcelain=v1", "-z"])
                .await
                .unwrap()
        );
        let unknown = read_at(&root, Some("../outside")).await.unwrap();
        assert!(unknown["files"][0]["after"].is_null());
        #[cfg(unix)]
        {
            let outside = tempfile::NamedTempFile::new().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("external")).unwrap();
            assert!(read_at(&root, Some("external")).await.is_err());
        }
    }
}
