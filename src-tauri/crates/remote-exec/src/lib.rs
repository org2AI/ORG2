//! Run a CLI agent on an SSH host and keep it running when the connection
//! does not.
//!
//! A plain `ssh host claude …` ties the agent's life to one TCP connection:
//! close the laptop and the turn is gone. Here the process is started
//! detached on the host with its output appended to log files, and the local
//! side replays those logs from a byte offset. Reconnecting is then just
//! "attach again from where I stopped".
//!
//! ```text
//!  session runner ── stdio ── org2-ssh-bridge ── ssh ── helper.sh attach ─┐
//!   (unchanged: it                │                                       │ tails
//!    spawns the bridge            ├── ssh ── helper.sh write <seq>  ──► stdin FIFO
//!    instead of the CLI)          └── ssh ── helper.sh ctl kill|…         │
//!                                                                         ▼
//!                              supervisor ── CLI agent ──► stdout.log / stderr.log / exit
//! ```
//!
//! The remote side is POSIX `sh` ([`script`]), installed over the same ssh
//! connection, so there is no binary to cross-compile or upload. Output is
//! exactly-once by construction (offsets only advance for bytes handed to the
//! local sink). Stdin is exactly-once through sequence-numbered messages that
//! the host stages and dedupes before they touch the FIFO.
//!
//! Out of scope for this crate: host registration, remote file access, git,
//! and surviving a restart of the desktop app itself.

pub mod bridge;
pub mod connector;
pub mod protocol;
pub mod quote;
pub mod script;
pub mod status;

pub use bridge::{run_bridge, BridgeError, BridgeExit, BridgeOptions};
#[cfg(unix)]
pub use connector::LocalShConnector;
pub use connector::{Connector, SshConnector};
pub use script::{RunSpec, StdinMode};
