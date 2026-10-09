//! `org2-ssh-bridge`: stands in for a CLI agent that runs on an SSH host.
//!
//! ```text
//! org2-ssh-bridge --host <alias> --run-id <id> --cwd <remote path>
//!     [--stdin pipe|null] [--forward-env NAME]... [--ssh-option Key=Value]...
//!     [--control-dir DIR] [--status-file PATH] [--no-login-path]
//!     [--keep-run-dir] -- <program> [args...]
//! ```
//!
//! Exits with the remote process's code, 125 when the bridge itself failed,
//! or 64 on a usage error. Env values are taken from this process's own
//! environment by name, so secrets never appear in a local argv either.

use std::path::PathBuf;
use std::sync::Arc;

use remote_exec::{run_bridge, BridgeOptions, RunSpec, SshConnector, StdinMode};

const EXIT_USAGE: i32 = 64;
const EXIT_BRIDGE_FAILURE: i32 = 125;

struct Cli {
    connector: SshConnector,
    spec: RunSpec,
    options: BridgeOptions,
}

fn parse(args: Vec<String>) -> Result<Cli, String> {
    let mut host = None;
    let mut run_id = None;
    let mut cwd = None;
    let mut stdin = StdinMode::Pipe;
    let mut forward_env = Vec::new();
    let mut ssh_options = Vec::new();
    let mut control_dir = None;
    let mut options = BridgeOptions::default();
    let mut resolve_login_path = true;
    let mut argv = Vec::new();

    let mut args = args.into_iter();
    while let Some(flag) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match flag.as_str() {
            "--host" => host = Some(value("--host")?),
            "--run-id" => run_id = Some(value("--run-id")?),
            "--cwd" => cwd = Some(value("--cwd")?),
            "--stdin" => {
                stdin = match value("--stdin")?.as_str() {
                    "pipe" => StdinMode::Pipe,
                    "null" => StdinMode::Null,
                    other => return Err(format!("--stdin must be pipe or null, got {other:?}")),
                }
            }
            "--forward-env" => forward_env.push(value("--forward-env")?),
            "--ssh-option" => ssh_options.push(value("--ssh-option")?),
            "--control-dir" => control_dir = Some(PathBuf::from(value("--control-dir")?)),
            "--status-file" => {
                options.status_file = Some(PathBuf::from(value("--status-file")?));
            }
            "--no-login-path" => resolve_login_path = false,
            "--keep-run-dir" => options.cleanup_on_exit = false,
            "--" => {
                argv = args.collect();
                break;
            }
            other => return Err(format!("unknown argument {other:?}")),
        }
    }

    let host = host.ok_or("--host is required")?;
    let mut connector = SshConnector::new(&host).map_err(|err| err.to_string())?;
    if let Some(dir) = control_dir {
        connector = connector.with_control_dir(dir);
    }
    for option in &ssh_options {
        connector = connector
            .with_option(option)
            .map_err(|err| err.to_string())?;
    }

    // A name that is not set locally is skipped, not forwarded as empty.
    let env = forward_env
        .into_iter()
        .filter_map(|name| std::env::var(&name).ok().map(|value| (name, value)))
        .collect();

    Ok(Cli {
        connector,
        spec: RunSpec {
            run_id: run_id.ok_or("--run-id is required")?,
            cwd: cwd.ok_or("--cwd is required")?,
            argv,
            env,
            stdin,
            resolve_login_path,
        },
        options,
    })
}

#[cfg(unix)]
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut terminate = signal(SignalKind::terminate()).expect("SIGTERM handler");
    let mut interrupt = signal(SignalKind::interrupt()).expect("SIGINT handler");
    let mut hangup = signal(SignalKind::hangup()).expect("SIGHUP handler");
    tokio::select! {
        _ = terminate.recv() => {}
        _ = interrupt.recv() => {}
        _ = hangup.recv() => {}
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = match parse(std::env::args().skip(1).collect()) {
        Ok(cli) => cli,
        Err(message) => {
            eprintln!("org2-ssh-bridge: {message}");
            std::process::exit(EXIT_USAGE);
        }
    };

    let stdin = (cli.spec.stdin == StdinMode::Pipe).then(tokio::io::stdin);
    let outcome = run_bridge(
        Arc::new(cli.connector),
        cli.spec,
        cli.options,
        stdin,
        tokio::io::stdout(),
        tokio::io::stderr(),
        shutdown_signal(),
    )
    .await;

    let code = match outcome {
        Ok(exit) => exit.code,
        Err(err) => {
            eprintln!("org2-ssh-bridge: {err}");
            EXIT_BRIDGE_FAILURE
        }
    };
    // tokio's stdin reader sits on a blocking thread that would hold a normal
    // return open until the parent closes the pipe.
    std::process::exit(code);
}
