//! Launch an installed vendor bundle into the exact managed profile. Dispatch
//! success is not a claim that the app has rendered or made a billable request.
#[cfg(target_os = "macos")]
mod account_home;
#[cfg(target_os = "macos")]
mod lifecycle;
#[cfg(target_os = "macos")]
pub(super) mod process;
use agent_cli::managed_config::native_app::NativeAppProfile;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
#[cfg(any(target_os = "macos", test))]
use std::process::Command;

#[cfg(any(target_os = "macos", test))]
use super::native_compatibility::bundle_id;
use super::native_compatibility::ResolvedNativeClient;

#[cfg(any(target_os = "macos", test))]
pub(super) const CLEARED_ENVIRONMENT: &[&str] = &[
    "CLAUDE_USER_DATA_DIR",
    "CLAUDE_CDP_AUTH",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_APP_SERVER_CHATGPT_BASE_URL",
    "CODEX_APP_SERVER_OPENAI_BASE_URL",
];

#[cfg(target_os = "macos")]
fn command(
    agent: &str,
    profile: &NativeAppProfile,
    client: &ResolvedNativeClient,
) -> Result<Command, String> {
    client.ensure_current()?;
    command_with_account_home(
        agent,
        profile,
        &client.bundle,
        &account_home::resolve()?,
        (agent == "codex").then(|| client.runtime()).transpose()?,
    )
}
#[cfg(any(target_os = "macos", test))]
fn command_with_account_home(
    agent: &str,
    profile: &NativeAppProfile,
    bundle: &Path,
    account_home: &Path,
    codex_runtime: Option<&Path>,
) -> Result<Command, String> {
    bundle_id(agent)?;
    profile.validate(agent)?;
    let mut command = Command::new("/usr/bin/open");
    command.arg("-n").arg("-a").arg(bundle);
    // open --env changes the launched process, whereas Command::env_remove
    // only changes the dispatcher. Empty explicit values mask launchd defaults.
    for name in CLEARED_ENVIRONMENT {
        command.env_remove(name).arg("--env").arg(name);
    }
    // Security.framework needs the OS account HOME to locate its default
    // Keychain. Foundation and vendor configuration stay profile-scoped below.
    let mut home = std::ffi::OsString::from("HOME=");
    home.push(account_home);
    command.arg("--env").arg(home);
    for (name, path) in [
        ("CFFIXED_USER_HOME", profile.system_home()),
        ("CLAUDE_CONFIG_DIR", profile.system_home().join(".claude")),
    ] {
        command
            .arg("--env")
            .arg(format!("{name}={}", path.display()));
    }
    if agent == "codex" {
        let runtime = codex_runtime
            .filter(|path| path.is_absolute())
            .ok_or("native_runtime_unverified")?;
        // This selects the intended binary; the vendor can still overwrite its
        // environment from a login shell. Lifecycle must observe the real child.
        command
            .arg("--env")
            .arg(format!("CODEX_CLI_PATH={}", runtime.display()));
        command.arg("--env").arg("CODEX_APP_SERVER_FORCE_CLI=1");
        command
            .arg("--env")
            .arg("CODEX_APP_SERVER_USE_LOCAL_DAEMON=0");
        command
            .arg("--env")
            .arg(format!("CODEX_HOME={}", profile.home().display()));
        command
            .arg("--env")
            .arg(format!("CODEX_SQLITE_HOME={}", profile.home().display()));
        command.arg("--env").arg(format!(
            "CODEX_ELECTRON_USER_DATA_PATH={}",
            profile.user_data().display()
        ));
    }
    command
        .arg("--args")
        .arg(format!("--user-data-dir={}", profile.user_data().display()));
    Ok(command)
}
#[cfg(any(target_os = "macos", all(test, unix)))]
#[derive(Debug)]
struct DispatchFailure {
    started: bool,
    message: &'static str,
}
/// Bound the LaunchServices dispatcher while config/owner locks are held.
/// Only this child is killed on timeout; a vendor App it launched is untouched.
#[cfg(any(target_os = "macos", all(test, unix)))]
fn run_dispatcher(
    command: &mut Command,
    timeout: std::time::Duration,
) -> Result<(), DispatchFailure> {
    let mut child = command.spawn().map_err(|_| DispatchFailure {
        started: false,
        message: "Could not start the official App dispatcher",
    })?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(DispatchFailure {
                        started: true,
                        message: "Could not open the isolated official App",
                    })
                }
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(DispatchFailure {
                    started: true,
                    message: if result.is_err() {
                        "Cannot inspect the official App dispatcher"
                    } else {
                        "Opening the isolated official App timed out; check its window before retrying"
                    },
                });
            }
        }
    }
}

pub(super) fn open(
    client: &ResolvedNativeClient,
    agent: &str,
    profile: &NativeAppProfile,
    check_owner: impl Fn() -> Result<(), String> + Clone + Send + Sync + 'static,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if client.agent != agent {
            return Err("Native App target changed".into());
        }
        client.ensure_current()?;
        profile.prepare_launch_directories()?;
        lifecycle::open(agent, profile, client, check_owner)?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (client, agent, profile, check_owner);
        Err("Opening official Apps is not available on this platform yet".into())
    }
}

#[cfg(target_os = "macos")]
pub(super) fn claude_history_writers_closed() -> Result<(), &'static str> {
    process::claude_writers_closed()
}

#[cfg(target_os = "macos")]
pub(super) use process::{claude_writer_identities, writer_identity_current};

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    pub(super) struct FixtureChild(pub(super) std::process::Child);
    #[cfg(target_os = "macos")]
    impl FixtureChild {
        pub(super) fn wait_for(
            &mut self,
            timeout: std::time::Duration,
        ) -> std::io::Result<Option<std::process::ExitStatus>> {
            let deadline = std::time::Instant::now() + timeout;
            loop {
                if let Some(status) = self.0.try_wait()? {
                    return Ok(Some(status));
                }
                if std::time::Instant::now() >= deadline {
                    return Ok(None);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
    #[cfg(target_os = "macos")]
    impl Drop for FixtureChild {
        fn drop(&mut self) {
            if matches!(self.0.try_wait(), Ok(Some(_))) {
                return;
            }
            let _ = self.0.kill();
            if !matches!(
                self.wait_for(std::time::Duration::from_secs(1)),
                Ok(Some(_))
            ) {
                eprintln!(
                    "Owned fixture PID {} did not reap within one second after kill",
                    self.0.id()
                );
            }
        }
    }
    #[cfg(unix)]
    #[test]
    fn dispatcher_completes_or_times_out_without_launching_gui() {
        let absent = run_dispatcher(
            &mut Command::new("/no/such/org2-test-dispatcher"),
            std::time::Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(!absent.started);
        run_dispatcher(
            &mut Command::new("/usr/bin/true"),
            std::time::Duration::from_secs(1),
        )
        .unwrap();
        let mut sleeping_child = Command::new("/bin/sleep");
        sleeping_child.arg("5");
        let start = std::time::Instant::now();
        assert!(
            run_dispatcher(&mut sleeping_child, std::time::Duration::from_millis(30))
                .unwrap_err()
                .message
                .contains("timed out")
        );
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
    }
    #[test]
    fn launch_targets_exact_bundle_and_same_profile_without_global_url_dispatch() {
        for agent in ["codex", "claude_desktop"] {
            let account_home = tempfile::tempdir().unwrap();
            let profile = NativeAppProfile::new(agent, "https://cloud.example", "owner").unwrap();
            let bundle = Path::new("/Applications/Vendor App.app");
            let command = command_with_account_home(
                agent,
                &profile,
                bundle,
                account_home.path(),
                Some(Path::new(
                    "/Applications/Vendor App.app/Contents/Resources/codex",
                )),
            )
            .unwrap();
            let args = command
                .get_args()
                .map(|v| v.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            assert_eq!(&args[..3], ["-n", "-a", "/Applications/Vendor App.app"]);
            assert_eq!(
                args.last().unwrap(),
                &format!("--user-data-dir={}", profile.user_data().display())
            );
            assert!(!args.iter().any(|v| v.contains("claude://") || v == "-b"));
            if agent == "codex" {
                assert!(args.contains(
                    &"CODEX_CLI_PATH=/Applications/Vendor App.app/Contents/Resources/codex".into()
                ));
                assert!(args.contains(&"CODEX_APP_SERVER_FORCE_CLI=1".into()));
                assert!(args.contains(&"CODEX_APP_SERVER_USE_LOCAL_DAEMON=0".into()));
                assert!(args.contains(&format!("CODEX_HOME={}", profile.home().display())));
                assert!(args.contains(&format!("CODEX_SQLITE_HOME={}", profile.home().display())));
                assert!(args.contains(&format!(
                    "CODEX_ELECTRON_USER_DATA_PATH={}",
                    profile.user_data().display()
                )));
            }
            assert!(args.contains(&format!("HOME={}", account_home.path().display())));
            assert!(!args.contains(&format!("HOME={}", profile.system_home().display())));
            assert!(args.contains(&format!(
                "CFFIXED_USER_HOME={}",
                profile.system_home().display()
            )));
            assert!(args.contains(&format!(
                "CLAUDE_CONFIG_DIR={}",
                profile.system_home().join(".claude").display()
            )));
            for name in [
                "CLAUDE_USER_DATA_DIR",
                "ANTHROPIC_API_KEY",
                "OPENAI_API_KEY",
                "CODEX_APP_SERVER_CHATGPT_BASE_URL",
                "CODEX_APP_SERVER_OPENAI_BASE_URL",
            ] {
                assert!(args.windows(2).any(|pair| pair == ["--env", name]));
            }
            assert!(command.get_envs().all(|(_, value)| value.is_none()));
        }
    }
}
