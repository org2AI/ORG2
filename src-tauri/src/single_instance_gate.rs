//! macOS admission before database/recovery bootstrap. The OS lock lives until
//! the primary exits; duplicate launches only forward to Tauri's existing IPC.
//! Never unlink the lock file: its stable inode is the cross-process authority.
use fs2::FileExt;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_DELAY: Duration = Duration::from_millis(50);

pub(crate) struct InstanceGuard {
    _file: File,
}

pub(crate) enum Admission {
    Primary(InstanceGuard),
    Forwarded(libc::pid_t),
}

struct Paths {
    lock: PathBuf,
    socket: PathBuf,
}

fn paths(identifier: &str) -> io::Result<Paths> {
    // Must match tauri-plugin-single-instance without its `semver` feature.
    if identifier.is_empty()
        || identifier.len() > 80
        || !identifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(io::Error::other("Invalid application identifier"));
    }
    let name = identifier.replace(['.', '-'], "_");
    let uid = unsafe { libc::geteuid() };
    let directory = PathBuf::from(format!("/tmp/org2-single-instance-{uid}"));
    match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = std::fs::symlink_metadata(&directory)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err(io::Error::other(
            "Single-instance lock directory is not private",
        ));
    }
    Ok(Paths {
        lock: directory.join(format!("{name}.lock")),
        socket: PathBuf::from(format!("/tmp/{name}_si.sock")),
    })
}

fn open_lock(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
        || metadata.nlink() != 1
    {
        return Err(io::Error::other(
            "Single-instance lock is not a private regular file",
        ));
    }
    Ok(file)
}

fn try_claim(file: &File) -> io::Result<bool> {
    match file.try_lock_exclusive() {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(false),
        Err(error) => Err(error),
    }
}

fn peer_pid(stream: &UnixStream) -> io::Result<libc::pid_t> {
    let mut uid = 0;
    let mut gid = 0;
    let credential_result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if credential_result != 0 {
        return Err(io::Error::last_os_error());
    }
    if uid != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Application singleton listener belongs to another user",
        ));
    }
    // <sys/un.h>: SOL_LOCAL / LOCAL_PEERPID are not exported by libc on Apple.
    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            0,
            0x002,
            std::ptr::addr_of_mut!(pid).cast(),
            &mut len,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if pid <= 0 {
        return Err(io::Error::other("Invalid single-instance peer"));
    }
    Ok(pid)
}

fn forward(socket: &Path, payload: &[u8]) -> io::Result<libc::pid_t> {
    let connection = socket2::Socket::new(socket2::Domain::UNIX, socket2::Type::STREAM, None)?;
    connection.connect_timeout(
        &socket2::SockAddr::unix(socket)?,
        Duration::from_millis(500),
    )?;
    let mut stream: UnixStream = connection.into();
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    let pid = peer_pid(&stream)?;
    stream.write_all(payload)?;
    Ok(pid)
}

fn admit(paths: &Paths, payload: &[u8], timeout: Duration) -> io::Result<Admission> {
    let file = open_lock(&paths.lock)?;
    let deadline = Instant::now() + timeout;
    loop {
        let owner = try_claim(&file)?;
        // Also forward to an already running older build that has no OS lock.
        match forward(&paths.socket, payload) {
            Ok(pid) => return Ok(Admission::Forwarded(pid)),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) =>
            {
                if owner {
                    return Ok(Admission::Primary(InstanceGuard { _file: file }));
                }
            }
            Err(error) => return Err(error),
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "The running application did not finish starting; retry after it is ready",
            ));
        }
        // Only a duplicate cold launch waits. Primary/idle/hidden paths have no polling.
        std::thread::sleep(RETRY_DELAY.min(deadline.saturating_duration_since(Instant::now())));
    }
}

pub(crate) fn prepare(identifier: &str) -> io::Result<Admission> {
    let paths = paths(identifier)?;
    let cwd = std::env::current_dir()?.to_string_lossy().into_owned();
    // Preserve the existing plugin's cwd + NUL NUL + NUL-separated argv wire format.
    // This payload can contain OAuth capabilities and must never be logged.
    let payload = format!(
        "{cwd}\0\0{}",
        std::env::args().collect::<Vec<_>>().join("\0")
    );
    if payload.len() > 64 * 1024 {
        return Err(io::Error::other(
            "Application launch arguments are too large",
        ));
    }
    admit(&paths, payload.as_bytes(), STARTUP_TIMEOUT)
}

/// Tauri's macOS plugin logs bind failures and continues. Fail closed before
/// the application setup hook if it did not establish our listener.
pub(crate) fn verify_listener(identifier: &str) -> io::Result<()> {
    verify_listener_at(&paths(identifier)?.socket, Duration::from_secs(2))
}

fn verify_listener_at(socket: &Path, timeout: Duration) -> io::Result<()> {
    // Newer upstream versions publish the listener asynchronously. Wait only at
    // startup and only for absence/refusal; a foreign owner must fail immediately.
    let deadline = Instant::now() + timeout;
    let pid = loop {
        match forward(socket, b"\0\0") {
            Ok(pid) => break pid,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) && Instant::now() < deadline =>
            {
                std::thread::sleep(
                    RETRY_DELAY.min(deadline.saturating_duration_since(Instant::now())),
                );
            }
            Err(error) => return Err(error),
        }
    };
    if pid != std::process::id() as libc::pid_t {
        return Err(io::Error::other(
            "Application singleton listener is owned by another process",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
