//! How a remote command line becomes a local process.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

use crate::quote::{validate_host_alias, validate_ssh_option, QuoteError};

/// Turns a remote command line into a local [`Command`] whose stdio is the
/// remote command's stdio. The bridge owns stdio wiring and lifetimes.
pub trait Connector: Send + Sync + 'static {
    fn command(&self, remote_command: &str) -> Command;

    /// Drop shared connection state after a failed attempt, so the next one
    /// does not queue behind a dead multiplexed connection.
    fn reset_command(&self) -> Option<Command> {
        None
    }

    /// Shown in errors and the status file.
    fn describe(&self) -> String;
}

/// The system `ssh` client, so `~/.ssh/config`, the agent, ProxyJump,
/// hardware keys and corporate wrappers all behave as in the user's terminal.
#[derive(Debug, Clone)]
pub struct SshConnector {
    alias: String,
    program: String,
    control_dir: Option<PathBuf>,
    extra_options: Vec<String>,
}

impl SshConnector {
    pub fn new(alias: &str) -> Result<Self, QuoteError> {
        validate_host_alias(alias)?;
        Ok(Self {
            alias: alias.to_string(),
            program: "ssh".to_string(),
            control_dir: None,
            extra_options: Vec::new(),
        })
    }

    /// Directory for ControlMaster sockets. Keep it short: a unix socket path
    /// is limited to about 104 bytes and `%C` alone takes 40.
    ///
    /// Ignored on Windows, whose OpenSSH client has no multiplexing.
    pub fn with_control_dir(mut self, dir: PathBuf) -> Self {
        self.control_dir = Some(dir);
        self
    }

    pub fn with_option(mut self, option: &str) -> Result<Self, QuoteError> {
        validate_ssh_option(option)?;
        self.extra_options.push(option.to_string());
        Ok(self)
    }

    pub fn with_program(mut self, program: &str) -> Self {
        self.program = program.to_string();
        self
    }

    fn base_args(&self) -> Vec<String> {
        let mut args = vec![
            // No tty: a tty would mangle the byte stream and tie the remote
            // process to the connection through SIGHUP.
            "-T".to_string(),
            // Never prompt. There is no terminal to answer on, and a hidden
            // prompt would look like a hang.
            "-oBatchMode=yes".to_string(),
            "-oConnectTimeout=15".to_string(),
            // Notice a dead peer within ~45s instead of waiting for TCP.
            "-oServerAliveInterval=15".to_string(),
            "-oServerAliveCountMax=3".to_string(),
        ];
        if cfg!(not(windows)) {
            if let Some(dir) = &self.control_dir {
                args.push("-oControlMaster=auto".to_string());
                args.push(format!("-oControlPath={}/%C", dir.display()));
                args.push("-oControlPersist=600".to_string());
            }
        }
        for option in &self.extra_options {
            args.push(format!("-o{option}"));
        }
        args
    }
}

impl Connector for SshConnector {
    fn command(&self, remote_command: &str) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(self.base_args())
            .arg("--")
            .arg(&self.alias)
            .arg(remote_command);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    }

    fn reset_command(&self) -> Option<Command> {
        if cfg!(windows) || self.control_dir.is_none() {
            return None;
        }
        let mut command = Command::new(&self.program);
        command
            .args(self.base_args())
            .arg("-Oexit")
            .arg("--")
            .arg(&self.alias)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Some(command)
    }

    fn describe(&self) -> String {
        format!("ssh host '{}'", self.alias)
    }
}

/// Runs the "remote" side with a local `sh` under a private home directory.
/// The protocol is identical, which makes the supervisor, resume and stdin
/// paths testable without an SSH server.
#[cfg(unix)]
#[derive(Debug, Clone)]
pub struct LocalShConnector {
    home: PathBuf,
    env: Vec<(String, String)>,
}

#[cfg(unix)]
impl LocalShConnector {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            env: Vec::new(),
        }
    }

    pub fn with_env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_string(), value.to_string()));
        self
    }
}

#[cfg(unix)]
impl Connector for LocalShConnector {
    fn command(&self, remote_command: &str) -> Command {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(remote_command)
            .current_dir(&self.home)
            .env("HOME", &self.home)
            // sshd gives every exec its own session; mirror that so a group
            // kill aimed at a run can never reach the calling process.
            .process_group(0);
        for (name, value) in &self.env {
            command.env(name, value);
        }
        command
    }

    fn describe(&self) -> String {
        format!("local sh under {}", self.home.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_of(command: &Command) -> Vec<String> {
        command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn ssh_command_places_the_alias_after_a_double_dash() {
        let connector = SshConnector::new("devbox")
            .unwrap()
            .with_option("Port=2222")
            .unwrap();
        let args = args_of(&connector.command("sh -s"));
        let dash = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(&args[dash + 1..], ["devbox", "sh -s"]);
        assert!(args.contains(&"-oBatchMode=yes".to_string()));
        assert!(args.contains(&"-oPort=2222".to_string()));
        assert!(args[..dash].iter().all(|arg| arg.starts_with('-')));
    }

    #[test]
    fn rejects_option_like_aliases_and_malformed_options() {
        assert!(SshConnector::new("-oProxyCommand=touch /tmp/x").is_err());
        assert!(SshConnector::new("devbox")
            .unwrap()
            .with_option("ProxyCommand")
            .is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn control_master_is_opt_in() {
        let plain = SshConnector::new("devbox").unwrap();
        assert!(plain.reset_command().is_none());
        assert!(!args_of(&plain.command("true"))
            .iter()
            .any(|arg| arg.starts_with("-oControl")));

        let muxed = plain.with_control_dir(PathBuf::from("/tmp/cm"));
        let args = args_of(&muxed.command("true"));
        assert!(args.contains(&"-oControlPath=/tmp/cm/%C".to_string()));
        assert!(muxed.reset_command().is_some());
    }
}
