//! Resolve the effective OS account, never the launcher's inherited HOME.
use std::{ffi::CStr, os::unix::ffi::OsStrExt, path::PathBuf};

pub(super) fn resolve() -> Result<PathBuf, String> {
    // A bounded lookup buffer avoids an unbounded retry for malformed directory
    // records. Fail closed instead of using a possibly isolated/injected HOME.
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result = std::ptr::null_mut();
    // SAFETY: entry, buffer and result are valid writable storage for this call.
    // The reentrant API keeps all returned string pointers inside buffer.
    let status = unsafe {
        libc::getpwuid_r(
            libc::geteuid(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return Err("Cannot resolve the OS account home for official App Keychain access".into());
    }
    // SAFETY: successful getpwuid_r with non-null result initialized entry.
    let entry = unsafe { entry.assume_init() };
    if entry.pw_dir.is_null() {
        return Err("The OS account has no home directory".into());
    }
    // SAFETY: pw_dir is a NUL-terminated string owned by the still-live buffer.
    let directory = unsafe { CStr::from_ptr(entry.pw_dir) };
    let home = PathBuf::from(std::ffi::OsStr::from_bytes(directory.to_bytes()));
    if !home.is_absolute() {
        return Err("The OS account home must be an absolute directory".into());
    }
    Ok(home)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn inherited_home_cannot_change_launched_app_account_home() {
        const EXPECTED: &str = "ORG2_TEST_EXPECTED_ACCOUNT_HOME";
        if let Some(expected) = std::env::var_os(EXPECTED) {
            let expected = PathBuf::from(expected);
            assert_eq!(resolve().unwrap(), expected);
            assert_ne!(std::env::var_os("HOME").unwrap(), expected.as_os_str());
            for agent in ["codex", "claude_desktop"] {
                let profile = agent_cli::managed_config::native_app::NativeAppProfile::new(
                    agent,
                    "https://cloud.example",
                    "owner",
                )
                .unwrap();
                let command = super::super::command(
                    agent,
                    &profile,
                    std::path::Path::new("/Applications/Vendor App.app"),
                )
                .unwrap();
                let mut home = std::ffi::OsString::from("HOME=");
                home.push(&expected);
                assert!(command.get_args().any(|arg| arg == home));
            }
            return;
        }
        let isolated = tempfile::tempdir().unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "market_connection::native_app_launch::account_home::tests::inherited_home_cannot_change_launched_app_account_home",
                "--nocapture",
            ])
            .env(EXPECTED, resolve().unwrap())
            .env("HOME", isolated.path())
            .env("CFFIXED_USER_HOME", isolated.path())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut child = super::super::tests::FixtureChild(child);
        let status = child
            .wait_for(std::time::Duration::from_secs(10))
            .unwrap()
            .expect("OS account home regression child timed out");
        let mut stdout = String::new();
        let mut stderr = String::new();
        child
            .0
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut stdout)
            .unwrap();
        child
            .0
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        assert!(status.success(), "{stdout}\n{stderr}");
        assert!(stdout.contains("1 passed"));
    }
}
