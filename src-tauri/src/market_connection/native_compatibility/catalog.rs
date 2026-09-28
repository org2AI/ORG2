//! Read the selected runtime's offline catalog, without a user profile or auth.
use super::ResolvedNativeClient;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::AsyncReadExt;

const MAX_BYTES: u64 = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) fn codex_bundled_catalog(
    client: &ResolvedNativeClient,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    let guard = || {
        check()?;
        client.ensure_current()
    };
    guard()?;
    let result = read(client.runtime()?, TIMEOUT, &guard)?;
    guard()?;
    Ok(result)
}

fn read(
    executable: &Path,
    timeout: Duration,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    check()?;
    let root = tempfile::tempdir().map_err(|_| "Cannot prepare offline native catalog")?;
    let home = root
        .path()
        .canonicalize()
        .map_err(|_| "Cannot resolve offline native catalog home")?;
    // No primary config, credentials, shell initialization, hooks or user cwd.
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut value = tokio::process::Command::new("/usr/bin/sandbox-exec");
        value.args(["-p", "(version 1)(allow default)(deny network*)"]);
        value.arg(executable);
        value
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = tokio::process::Command::new(executable);
    command
        .args(["debug", "models", "--bundled"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .current_dir(&home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for name in [
        "HOME",
        "CFFIXED_USER_HOME",
        "CODEX_HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_DATA_HOME",
        "TMPDIR",
    ] {
        command.env(name, &home);
    }
    #[cfg(windows)]
    for name in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Cannot prepare offline native catalog runtime")?;
    runtime.block_on(async {
        let mut child = command.spawn().map_err(|_| "native_catalog_unavailable")?;
        let stdout = child.stdout.take().ok_or("native_catalog_unavailable")?;
        let result = {
            let work = async {
                let mut bytes = Vec::new();
                stdout
                    .take(MAX_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .await
                    .map_err(|_| "native_catalog_unavailable")?;
                if bytes.len() as u64 > MAX_BYTES {
                    return Err("native_catalog_too_large".to_owned());
                }
                let status = child
                    .wait()
                    .await
                    .map_err(|_| "native_catalog_unavailable")?;
                if !status.success() {
                    return Err("native_catalog_unsupported".into());
                }
                let value: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|_| "native_catalog_invalid")?;
                if !value.get("models").is_some_and(serde_json::Value::is_array) {
                    return Err("native_catalog_invalid".into());
                }
                Ok(value)
            };
            tokio::pin!(work);
            let deadline = tokio::time::sleep(timeout);
            tokio::pin!(deadline);
            // Only exists during this bounded user action. No background retry.
            let mut checkpoint = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    value = &mut work => break value,
                    _ = &mut deadline => break Err("native_catalog_timeout".into()),
                    _ = checkpoint.tick() => if let Err(error) = check() { break Err(error); },
                }
            }
        };
        // Cancellation/oversized output must reap the owned process as well.
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
        }
        check()?;
        result
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{cell::Cell, os::unix::fs::PermissionsExt};

    fn script(root: &Path, content: &str) -> std::path::PathBuf {
        let path = root.join("runtime");
        std::fs::write(&path, format!("#!/bin/sh\n{content}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[test]
    fn offline_catalog_checks_real_output_and_uses_an_empty_profile() {
        let root = tempfile::tempdir().unwrap();
        let binary = script(
            root.path(),
            r#"
test "$1 $2 $3" = 'debug models --bundled' || exit 2
test "$HOME" = "$CODEX_HOME" && test "$HOME" = "$PWD" || exit 3
test ! -f "$HOME/auth.json" && test ! -f "$HOME/config.toml" || exit 4
test -z "$OPENAI_API_KEY$ANTHROPIC_API_KEY$CODEX_CLI_PATH" || exit 5
printf '{"models":[{"slug":"native-observed-model"}]}'
"#,
        );
        let result = read(&binary, Duration::from_secs(2), &|| Ok(())).unwrap();
        assert_eq!(result["models"][0]["slug"], "native-observed-model");
        for (output, expected) in [
            ("printf '{}'", "native_catalog_invalid"),
            ("printf 'invalid'", "native_catalog_invalid"),
            ("exit 1", "native_catalog_unsupported"),
        ] {
            let binary = script(root.path(), output);
            assert_eq!(
                read(&binary, Duration::from_secs(2), &|| Ok(())).unwrap_err(),
                expected
            );
        }
    }

    #[test]
    fn catalog_timeout_size_and_revocation_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let binary = script(root.path(), "exec sleep 5");
        assert_eq!(
            read(&binary, Duration::from_millis(20), &|| Ok(())).unwrap_err(),
            "native_catalog_timeout"
        );
        let calls = Cell::new(0);
        assert_eq!(
            read(&binary, Duration::from_secs(2), &|| {
                calls.set(calls.get() + 1);
                if calls.get() > 1 {
                    Err("owner retired".into())
                } else {
                    Ok(())
                }
            })
            .unwrap_err(),
            "owner retired"
        );
        let binary = script(root.path(), "exec head -c 4194305 /dev/zero");
        assert_eq!(
            read(&binary, Duration::from_secs(2), &|| Ok(())).unwrap_err(),
            "native_catalog_too_large"
        );
    }
}
