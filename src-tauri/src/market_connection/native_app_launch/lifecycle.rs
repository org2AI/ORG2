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

fn pending_state(file: &mut File, boot: &[u8]) -> Result<(bool, Option<Identity>), String> {
    let mut bytes = Vec::new();
    file.seek(SeekFrom::Start(0)).map_err(|_| UNCERTAIN)?;
    file.take(257)
        .read_to_end(&mut bytes)
        .map_err(|_| UNCERTAIN)?;
    if bytes.is_empty() {
        return Ok((false, None));
    }
    // A boot UUID is 36 ASCII bytes and its terminating NUL. Unknown/partial
    // state must never be interpreted as permission to spawn another writer.
    if bytes.len() < 37
        || bytes.len() > 256
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
    let observed = if bytes.len() == 37 {
        None // Existing boot-only reservations remain fail-closed.
    } else {
        let payload = bytes[37..].strip_prefix(b"observed-v1:").ok_or(UNCERTAIN)?;
        let (pid, seconds, micros): (i32, u64, u64) =
            serde_json::from_slice(payload).map_err(|_| UNCERTAIN)?;
        if pid <= 0 || seconds == 0 || micros >= 1_000_000 {
            return Err(UNCERTAIN.into());
        }
        Some(Identity {
            pid,
            started: (seconds, micros),
        })
    };
    Ok((&bytes[..37] == boot, observed))
}

#[cfg(test)]
fn pending(file: &mut File, boot: &[u8]) -> Result<bool, String> {
    pending_state(file, boot).map(|(pending, _)| pending)
}

fn record_observed(file: &mut File, boot: &[u8], identity: &Identity) -> Result<(), String> {
    let mut bytes = boot.to_vec();
    bytes.extend_from_slice(b"observed-v1:");
    bytes.extend(
        serde_json::to_vec(&(identity.pid, identity.started.0, identity.started.1))
            .map_err(|_| UNCERTAIN)?,
    );
    record(file, &bytes)
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
    fn ready(&mut self, identity: &Identity) -> Result<bool, String>;
    fn exited(&mut self, identity: &Identity) -> Result<bool, String>;
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
    let mut existing = runtime.find()?;
    check_owner()?;
    if existing.is_none() {
        let (pending, observed) = pending_state(reservation, boot)?;
        if pending {
            let observed = observed.ok_or(UNCERTAIN)?;
            if !runtime.exited(&observed)? {
                return Err(UNCERTAIN.into());
            }
            // An observed launch has terminated, unlike a dispatch that may
            // still be queued. Recheck the profile before allowing a new one.
            check_owner()?;
            existing = runtime.find()?;
        }
    }
    record(reservation, boot)?;
    if let Err(error) = check_owner() {
        if existing.is_none() {
            record(reservation, &[])?;
        }
        return Err(error);
    }
    let deadline = Instant::now() + timeout;
    if existing.is_none() {
        // A failed dispatcher may still have delivered its launch request.
        if let Err(error) = runtime.dispatch() {
            if !error.started {
                record(reservation, &[])?;
            }
            return Err(error.message.into());
        }
    }
    let mut candidate = existing;
    let mut observed = None;
    loop {
        check_owner()?;
        let found = match candidate.take() {
            Some(value) => Some(value),
            None => runtime.find()?,
        };
        if let Some(identity) = found {
            check_owner()?;
            if observed.as_ref() != Some(&identity) {
                record_observed(reservation, boot, &identity)?;
                observed = Some(identity.clone());
            }
            if runtime.ready(&identity)? {
                check_owner()?;
                // Runtime identity is proven before clearing the reservation.
                // Activation can fail without creating a second writer.
                record(reservation, &[])?;
                check_owner()?;
                let result = runtime.activate(&identity);
                if result.is_err() && !runtime.ready(&identity).unwrap_or(false) {
                    // Binding can disappear while the main-thread activation
                    // is queued. Do not turn that ambiguity into a free retry.
                    record_observed(reservation, boot, &identity)?;
                }
                return result;
            }
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
    client: &super::ResolvedNativeClient,
    check_owner: impl Fn() -> Result<(), String> + Clone + Send + Sync + 'static,
) -> Result<(), String> {
    let bundle = &client.bundle;
    let executable = &client.executable;
    if process::executable(bundle)? != *executable {
        return Err("native_app_changed".into());
    }
    let selected = client.clone();
    let check_owner = move || {
        selected.ensure_current()?;
        check_owner()
    };
    let user_data = profile
        .user_data()
        .canonicalize()
        .map_err(|_| "Cannot resolve official App profile")?;
    let mut reservation = lock(&profile.root().join("org2-launch.lock"))?;
    profile.validate(agent)?;
    let mut command = super::command(agent, profile, client)?;
    struct MacRuntime<'a, C> {
        check_owner: C,
        executable: &'a Path,
        bundle_id: &'a str,
        profile: &'a Path,
        managed_profile: &'a NativeAppProfile,
        command: &'a mut std::process::Command,
        client: &'a super::ResolvedNativeClient,
        binding: Option<process::ProfileBinding>,
    }
    impl<C: Fn() -> Result<(), String> + Clone + Send + Sync + 'static> Runtime for MacRuntime<'_, C> {
        fn find(&mut self) -> Result<Option<Identity>, String> {
            process::find(self.executable, self.profile, self.bundle_id)
        }
        fn exited(&mut self, identity: &Identity) -> Result<bool, String> {
            process::has_exited(identity)
        }
        fn ready(&mut self, identity: &Identity) -> Result<bool, String> {
            self.binding =
                match process::ProfileBinding::observe(self.client, identity, self.managed_profile)
                {
                    Err(reason) if reason == "native_runtime_unverified" => None,
                    result => result?,
                };
            Ok(self.binding.is_some())
        }
        fn activate(&mut self, identity: &Identity) -> Result<(), String> {
            let client = self.client.clone();
            let binding = self.binding.clone();
            let owner = self.check_owner.clone();
            process::activate(identity, self.executable, self.profile, move || {
                owner()?;
                binding
                    .as_ref()
                    .ok_or("native_profile_runtime_unverified")?
                    .check(&client)
            })
        }
        fn dispatch(&mut self) -> Result<(), super::DispatchFailure> {
            super::run_dispatcher(self.command, STARTUP_TIMEOUT)
        }
    }
    let mut runtime = MacRuntime {
        check_owner: check_owner.clone(),
        executable,
        bundle_id: super::bundle_id(agent)?,
        profile: &user_data,
        managed_profile: profile,
        command: &mut command,
        client,
        binding: None,
    };
    run(
        &mut reservation,
        &process::boot()?,
        check_owner.clone(),
        &mut runtime,
        STARTUP_TIMEOUT,
    )?;
    runtime
        .binding
        .map(|_| ())
        .ok_or_else(|| "native_profile_runtime_unverified".into())
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
