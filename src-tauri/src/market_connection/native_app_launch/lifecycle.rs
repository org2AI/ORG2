//! A profile-scoped launch reservation survives an uncertain dispatcher result.
//! No timer or process registry remains active after this user action returns.
use super::process::{self, Identity};
use agent_cli::managed_config::native_app::NativeAppProfile;
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    time::{Duration, Instant},
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const STARTUP_POLL: Duration = Duration::from_millis(250);
const UNCERTAIN: &str = "An earlier official App launch is not yet confirmed. Check its window and retry Open; if no window ever appears, restart macOS before retrying. ORG2 will not start another writer for this profile";

fn lock(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "Cannot open official App launch reservation")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect official App launch reservation")?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
        || metadata.nlink() != 1
    {
        return Err("Official App launch reservation is not a private regular file".into());
    }
    file.try_lock_exclusive()
        .map_err(|_| "This Package App is already being opened; retry when it finishes")?;
    Ok(file)
}

fn pending(file: &mut File, boot: &[u8]) -> Result<bool, String> {
    let mut bytes = Vec::new();
    file.seek(SeekFrom::Start(0)).map_err(|_| UNCERTAIN)?;
    file.take(65)
        .read_to_end(&mut bytes)
        .map_err(|_| UNCERTAIN)?;
    if bytes.is_empty() {
        return Ok(false);
    }
    // A boot UUID is 36 ASCII bytes and its terminating NUL. Unknown/partial
    // state must never be interpreted as permission to spawn another writer.
    if bytes.len() != 37
        || bytes[36] != 0
        || bytes[..36].iter().enumerate().any(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b != b'-'
            } else {
                !b.is_ascii_hexdigit()
            }
        })
    {
        return Err("Official App launch reservation is malformed; its previous launch cannot be verified. Contact support before retrying this profile".into());
    }
    Ok(bytes == boot)
}

fn record(file: &mut File, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() && file.metadata().is_ok_and(|metadata| metadata.len() == 0) {
        return Ok(());
    }
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.write_all(bytes))
        .and_then(|_| file.set_len(bytes.len() as u64))
        .and_then(|_| file.sync_data())
        .map_err(|_| "Cannot save official App launch reservation".into())
}

trait Runtime {
    fn find(&mut self) -> Result<Option<Identity>, String>;
    fn activate(&mut self, identity: &Identity) -> Result<(), String>;
    fn dispatch(&mut self) -> Result<(), super::DispatchFailure>;
}

fn run(
    reservation: &mut File,
    boot: &[u8],
    check_owner: impl Fn() -> Result<(), String>,
    runtime: &mut impl Runtime,
    timeout: Duration,
) -> Result<(), String> {
    check_owner()?;
    if let Some(identity) = runtime.find()? {
        check_owner()?;
        // Finding one verified writer resolves even a prior timed-out launch.
        // Clear before activation: inability to focus is not absence of a writer.
        record(reservation, &[])?;
        check_owner()?;
        return runtime.activate(&identity);
    }
    if pending(reservation, boot)? {
        return Err(UNCERTAIN.into());
    }
    check_owner()?;
    record(reservation, boot)?;
    if let Err(error) = check_owner() {
        // Dispatch has not begun, so this reservation is known to be unused.
        record(reservation, &[])?;
        return Err(error);
    }
    // Even a failed/timed-out open may have delivered its launch request. Keep
    // the reservation until a unique writer is observed or macOS has rebooted.
    let deadline = Instant::now() + timeout;
    if let Err(error) = runtime.dispatch() {
        if !error.started {
            record(reservation, &[])?;
        }
        return Err(error.message.into());
    }
    loop {
        check_owner()?;
        if let Some(identity) = runtime.find()? {
            check_owner()?;
            record(reservation, &[])?;
            check_owner()?;
            return runtime.activate(&identity);
        }
        if Instant::now() >= deadline {
            return Err(UNCERTAIN.into());
        }
        std::thread::sleep(STARTUP_POLL.min(deadline.saturating_duration_since(Instant::now())));
    }
}

pub(super) fn open(
    agent: &str,
    profile: &NativeAppProfile,
    bundle: &Path,
    check_owner: impl Fn() -> Result<(), String> + Clone + Send + Sync + 'static,
) -> Result<(), String> {
    let executable = process::executable(bundle)?;
    let user_data = profile
        .user_data()
        .canonicalize()
        .map_err(|_| "Cannot resolve official App profile")?;
    let mut reservation = lock(&profile.root().join("org2-launch.lock"))?;
    profile.validate(agent)?;
    let mut command = super::command(agent, profile, bundle)?;
    struct MacRuntime<'a, C> {
        check_owner: C,
        executable: &'a Path,
        bundle_id: &'a str,
        profile: &'a Path,
        command: &'a mut std::process::Command,
    }
    impl<C: Fn() -> Result<(), String> + Clone + Send + Sync + 'static> Runtime for MacRuntime<'_, C> {
        fn find(&mut self) -> Result<Option<Identity>, String> {
            process::find(self.executable, self.profile, self.bundle_id)
        }
        fn activate(&mut self, identity: &Identity) -> Result<(), String> {
            process::activate(
                identity,
                self.executable,
                self.profile,
                self.check_owner.clone(),
            )
        }
        fn dispatch(&mut self) -> Result<(), super::DispatchFailure> {
            super::run_dispatcher(self.command, STARTUP_TIMEOUT)
        }
    }
    run(
        &mut reservation,
        &process::boot()?,
        check_owner.clone(),
        &mut MacRuntime {
            check_owner,
            executable: &executable,
            bundle_id: super::bundle_id(agent)?,
            profile: &user_data,
            command: &mut command,
        },
        STARTUP_TIMEOUT,
    )
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
