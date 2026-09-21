//! Remote command lines and the generated launch script.

use thiserror::Error;

use crate::quote::{
    pick_heredoc_delimiter, sh_quote, validate_env_name, validate_run_id, QuoteError,
};

/// Bumped when the run directory layout or the frame format changes.
pub const PROTOCOL_VERSION: &str = "v1";

const HELPER_SOURCE: &str = include_str!("scripts/helper.sh");

/// Whether the remote process gets a stdin the desktop can write to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdinMode {
    /// FIFO held open across disconnects; EOF only on request.
    Pipe,
    /// `/dev/null`, for CLIs that take their whole input from argv.
    Null,
}

impl StdinMode {
    fn as_str(self) -> &'static str {
        match self {
            StdinMode::Pipe => "pipe",
            StdinMode::Null => "null",
        }
    }
}

/// One detached process to start on the remote host.
#[derive(Debug, Clone)]
pub struct RunSpec {
    /// Unique per run; also the remote directory name.
    pub run_id: String,
    /// Absolute path on the remote host.
    pub cwd: String,
    /// Program and arguments. The program is resolved on the remote `PATH`.
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub stdin: StdinMode,
    /// Take `PATH` from the remote login shell, so CLIs installed by nvm and
    /// friends resolve the way they do in the user's own terminal.
    pub resolve_login_path: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SpecError {
    #[error(transparent)]
    Quote(#[from] QuoteError),
    #[error("argv is empty")]
    EmptyArgv,
    #[error("cwd must be an absolute remote path, got {0:?}")]
    RelativeCwd(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Term,
    Kill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CtlAction {
    CloseStdin,
    Kill(Signal),
    Status,
    Cleanup,
}

fn helper_source() -> String {
    // A Windows checkout may hand us CRLF; `sh` would choke on the `\r`.
    HELPER_SOURCE.replace("\r\n", "\n")
}

/// FNV-1a, only to give each helper revision its own install directory so an
/// app upgrade never swaps the script under a run that is still attached.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn helper_dir_name() -> String {
    let hash = fnv1a(helper_source().as_bytes());
    format!("{PROTOCOL_VERSION}-{:08x}", hash as u32)
}

/// Relative to the remote home directory, which is where sshd starts every
/// command. Only safe characters, so command lines built from it need no
/// quoting and survive any login shell.
fn helper_rel_path() -> String {
    format!(".orgii/remote/{}/helper.sh", helper_dir_name())
}

pub fn attach_command(run_id: &str, stdout_offset: u64, stderr_offset: u64) -> String {
    format!(
        "sh {} attach {run_id} {stdout_offset} {stderr_offset}",
        helper_rel_path()
    )
}

pub fn write_command(run_id: &str, seq: u64, len: usize) -> String {
    format!("sh {} write {run_id} {seq} {len}", helper_rel_path())
}

pub fn ctl_command(run_id: &str, action: CtlAction) -> String {
    let action = match action {
        CtlAction::CloseStdin => "close-stdin",
        CtlAction::Kill(Signal::Term) => "kill TERM",
        CtlAction::Kill(Signal::Kill) => "kill KILL",
        CtlAction::Status => "status",
        CtlAction::Cleanup => "cleanup",
    };
    format!("sh {} ctl {run_id} {action}", helper_rel_path())
}

/// The remote command that reads [`launch_script`] from its stdin.
pub const LAUNCH_COMMAND: &str = "sh -s";

/// Build the script that installs the helper and starts the run.
///
/// It is fed to `sh -s` over stdin, never placed in a remote argv, so env
/// values and prompts do not show up in the host's process list. The body is
/// one function called on the last line: a connection that dies mid-transfer
/// leaves an incomplete definition, which is a syntax error, not a
/// half-executed launch.
pub fn launch_script(spec: &RunSpec) -> Result<String, SpecError> {
    validate_run_id(&spec.run_id)?;
    if spec.argv.is_empty() {
        return Err(SpecError::EmptyArgv);
    }
    if !spec.cwd.starts_with('/') {
        return Err(SpecError::RelativeCwd(spec.cwd.clone()));
    }
    let cwd = sh_quote(&spec.cwd)?;

    let mut cmd = String::from("rm -f -- \"$0\"\n");
    cmd.push_str(&format!("cd {cwd} || exit 97\n"));
    for (name, value) in &spec.env {
        validate_env_name(name)?;
        cmd.push_str(&format!("export {name}={}\n", sh_quote(value)?));
    }
    cmd.push_str("exec");
    for arg in &spec.argv {
        cmd.push(' ');
        cmd.push_str(&sh_quote(arg)?);
    }
    cmd.push('\n');

    let helper = helper_source();
    let helper_eof = pick_heredoc_delimiter("ORGII_HELPER_EOF", &[&helper]);
    let cmd_eof = pick_heredoc_delimiter("ORGII_CMD_EOF", &[&cmd]);
    let run_id = &spec.run_id;
    let helper_dir = helper_dir_name();
    let stdin_mode = spec.stdin.as_str();
    let login_path = u8::from(spec.resolve_login_path);
    let make_fifo = match spec.stdin {
        StdinMode::Pipe => {
            "mkfifo \"$run_dir/stdin\" || { echo 'ORGII-ERR mkfifo-failed'; exit 73; }\n"
        }
        StdinMode::Null => "",
    };

    Ok(format!(
        r#"orgii_launch() {{
set -u
umask 077
base="$HOME/.orgii/remote"
helper_dir="$base/{helper_dir}"
run_dir="$base/runs/{run_id}"
mkdir -p "$helper_dir" "$base/runs" || {{ echo 'ORGII-ERR mkdir-failed'; exit 73; }}
if [ -d "$run_dir" ]; then
    if [ -e "$run_dir/launched" ]; then echo 'ORGII-LAUNCHED existing'; exit 0; fi
    echo 'ORGII-ERR incomplete-run-dir'; exit 75
fi
for old in "$base"/runs/*/; do
    [ -f "${{old}}exit" ] || continue
    [ -n "$(find "${{old}}exit" -mtime +7 2>/dev/null)" ] && rm -rf "$old"
done
cat >"$helper_dir/helper.sh.$$" <<'{helper_eof}'
{helper}{helper_eof}
mv -f "$helper_dir/helper.sh.$$" "$helper_dir/helper.sh" || {{ echo 'ORGII-ERR helper-install-failed'; exit 73; }}
[ -d {cwd} ] || {{ echo 'ORGII-ERR cwd-missing'; exit 97; }}
mkdir "$run_dir" || {{ echo 'ORGII-ERR mkdir-failed'; exit 73; }}
cat >"$run_dir/cmd.sh" <<'{cmd_eof}'
{cmd}{cmd_eof}
{make_fifo}: >"$run_dir/stdout.log"
: >"$run_dir/stderr.log"
if command -v setsid >/dev/null 2>&1; then
    setsid sh "$helper_dir/helper.sh" supervise {run_id} {stdin_mode} {login_path} </dev/null >"$run_dir/supervisor.log" 2>&1 &
else
    sh "$helper_dir/helper.sh" supervise {run_id} {stdin_mode} {login_path} </dev/null >"$run_dir/supervisor.log" 2>&1 &
fi
: >"$run_dir/launched"
echo 'ORGII-LAUNCHED new'
}}
orgii_launch
"#
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> RunSpec {
        RunSpec {
            run_id: "run-1".to_string(),
            cwd: "/srv/project".to_string(),
            argv: vec!["claude".to_string(), "-p".to_string(), "hi".to_string()],
            env: vec![],
            stdin: StdinMode::Null,
            resolve_login_path: true,
        }
    }

    #[test]
    fn remote_commands_need_no_quoting() {
        for command in [
            attach_command("run-1", 10, 20),
            write_command("run-1", 3, 42),
            ctl_command("run-1", CtlAction::Kill(Signal::Kill)),
            ctl_command("run-1", CtlAction::CloseStdin),
        ] {
            assert!(
                command
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b" ./_-".contains(&b)),
                "unexpected character in {command:?}"
            );
        }
        assert!(attach_command("run-1", 10, 20).ends_with(" attach run-1 10 20"));
    }

    #[test]
    fn helper_is_lf_only_and_versioned() {
        assert!(!helper_source().contains('\r'));
        assert!(helper_dir_name().starts_with("v1-"));
    }

    #[test]
    fn rejects_bad_specs() {
        let mut bad = spec();
        bad.run_id = "../x".to_string();
        assert!(matches!(launch_script(&bad), Err(SpecError::Quote(_))));

        let mut bad = spec();
        bad.argv.clear();
        assert_eq!(launch_script(&bad), Err(SpecError::EmptyArgv));

        let mut bad = spec();
        bad.cwd = "relative/path".to_string();
        assert!(matches!(
            launch_script(&bad),
            Err(SpecError::RelativeCwd(_))
        ));

        let mut bad = spec();
        bad.env.push(("BAD NAME".to_string(), "x".to_string()));
        assert!(matches!(launch_script(&bad), Err(SpecError::Quote(_))));
    }

    #[test]
    fn prompt_text_cannot_close_the_command_heredoc() {
        let mut hostile = spec();
        hostile
            .argv
            .push("first\nORGII_CMD_EOF_0\necho pwned".to_string());
        let script = launch_script(&hostile).unwrap();
        assert!(script.contains("<<'ORGII_CMD_EOF_1'"));
        assert!(!script.contains("<<'ORGII_CMD_EOF_0'"));
    }

    #[test]
    fn env_values_are_quoted_not_interpolated() {
        let mut with_env = spec();
        with_env
            .env
            .push(("TOKEN".to_string(), "a'b $(id)".to_string()));
        let script = launch_script(&with_env).unwrap();
        assert!(script.contains("export TOKEN='a'\\''b $(id)'\n"));
    }
}
