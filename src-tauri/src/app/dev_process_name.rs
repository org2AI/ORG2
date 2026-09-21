//! macOS uses a bare executable's filename for its Dock tooltip. Tauri's
//! productName applies to bundles, so dev must exec a suitably named file
//! before AppKit/LaunchServices sees the process. A sibling hard link keeps
//! sidecar/resource lookup unchanged and avoids copying the large binary.

use std::io;
use std::path::{Path, PathBuf};

const DEV_IDENTIFIER: &str = "org2ai.org2.dev";
const DEV_EXECUTABLE_NAME: &str = "ORG2 Dev";

fn needs_named_executable(identifier: &str, executable: &Path) -> bool {
    if identifier != DEV_IDENTIFIER
        || executable
            .file_name()
            .is_some_and(|name| name == DEV_EXECUTABLE_NAME)
    {
        return false;
    }
    // Packaged builds already get their name from Contents/Info.plist.
    !executable.parent().is_some_and(|macos| {
        macos.file_name().is_some_and(|name| name == "MacOS")
            && macos.parent().is_some_and(|contents| {
                contents.file_name().is_some_and(|name| name == "Contents")
                    && contents
                        .parent()
                        .is_some_and(|bundle| bundle.extension().is_some_and(|ext| ext == "app"))
            })
    })
}

fn prepare_named_executable(executable: &Path) -> io::Result<PathBuf> {
    let destination = executable.with_file_name(DEV_EXECUTABLE_NAME);
    let staging = executable.with_file_name(format!(".org2-dev-name-{}", std::process::id()));
    // Stage then atomically replace the previous dev alias: a rebuild may
    // have replaced Cargo's original inode since the last launch.
    std::fs::hard_link(executable, &staging)?;
    let result = std::fs::rename(&staging, &destination);
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result?;
    Ok(destination)
}

pub(crate) fn reexec_dev_with_display_name(identifier: &str) -> io::Result<()> {
    use std::os::unix::process::CommandExt;

    if identifier != DEV_IDENTIFIER {
        return Ok(());
    }
    let executable = std::env::current_exe()?;
    if !needs_named_executable(identifier, &executable) {
        return Ok(());
    }
    let named = prepare_named_executable(&executable)?;
    // exec preserves PID, parentage, environment, cwd and inherited stdio.
    // Cargo/Tauri therefore still supervise exactly the same app process.
    Err(std::process::Command::new(named)
        .args(std::env::args_os().skip(1))
        .exec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::MetadataExt;
    use std::process::Command;

    #[test]
    fn only_bare_dev_executables_need_renaming() {
        let bare = Path::new("/build/debug/org2");
        assert!(needs_named_executable(DEV_IDENTIFIER, bare));
        for identifier in [
            "org2ai.org2",
            "org2ai.org2.instance2",
            "org2ai.org2.e2e.instance2",
        ] {
            assert!(!needs_named_executable(identifier, bare));
        }
        assert!(!needs_named_executable(
            DEV_IDENTIFIER,
            Path::new("/build/debug/ORG2 Dev")
        ));
        assert!(!needs_named_executable(
            DEV_IDENTIFIER,
            Path::new("/build/ORG2 Dev.app/Contents/MacOS/org2")
        ));
    }

    #[test]
    fn alias_tracks_rebuilt_binary_without_copying_or_moving_it() {
        let sandbox = tempfile::tempdir().unwrap();
        let binary = sandbox.path().join("org2");
        std::fs::write(&binary, b"first build").unwrap();
        let named = prepare_named_executable(&binary).unwrap();
        assert_eq!(
            std::fs::metadata(&binary).unwrap().ino(),
            std::fs::metadata(&named).unwrap().ino()
        );
        std::fs::remove_file(&binary).unwrap();
        std::fs::write(&binary, b"second build").unwrap();
        prepare_named_executable(&binary).unwrap();
        assert_eq!(std::fs::read(named).unwrap(), b"second build");
        assert_eq!(std::fs::read(binary).unwrap(), b"second build");
        assert_eq!(std::fs::read_dir(sandbox.path()).unwrap().count(), 2);
    }

    #[test]
    fn named_process_child() {
        if std::env::var_os("ORGII_NAME_TEST_CHILD").is_none() {
            return;
        }
        let before = std::env::var("ORGII_NAME_TEST_PID").ok();
        if before.is_none() {
            std::env::set_var("ORGII_NAME_TEST_PID", std::process::id().to_string());
        }
        reexec_dev_with_display_name(DEV_IDENTIFIER).unwrap();
        assert_eq!(
            std::env::current_exe().unwrap().file_name().unwrap(),
            DEV_EXECUTABLE_NAME
        );
        assert_eq!(before.unwrap(), std::process::id().to_string());
        assert_eq!(
            std::env::current_dir().unwrap(),
            PathBuf::from(std::env::var_os("ORGII_NAME_TEST_CWD").unwrap())
        );
        assert!(std::env::args().any(|arg| arg.ends_with("::named_process_child")));
    }

    #[test]
    fn reexec_preserves_pid_arguments_environment_and_working_directory() {
        let sandbox = tempfile::tempdir().unwrap();
        let binary = sandbox.path().join("org2");
        std::fs::copy(std::env::current_exe().unwrap(), &binary).unwrap();
        let cwd = sandbox.path().canonicalize().unwrap();
        let child_name = format!(
            "{}::named_process_child",
            module_path!().split_once("::").unwrap().1
        );
        let result = Command::new(binary)
            .args(["--exact", &child_name, "--nocapture"])
            .env("ORGII_NAME_TEST_CHILD", "1")
            .env("ORGII_NAME_TEST_CWD", &cwd)
            .env_remove("ORGII_NAME_TEST_PID")
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(sandbox.path().join(DEV_EXECUTABLE_NAME).exists());
    }
}
