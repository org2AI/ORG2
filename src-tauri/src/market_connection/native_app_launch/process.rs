//! Inspect kernel process identity, never shell-formatted command strings.
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Identity {
    pub pid: i32,
    pub started: (u64, u64),
}

/// KERN_PROCARGS2 contains argc, executable, padding, argv, then environment.
/// Parse exactly argc arguments so credentials in the environment are not read
/// as arguments or retained in the returned value.
fn arguments(bytes: &[u8]) -> Result<Vec<&[u8]>, String> {
    let invalid = "Cannot inspect official App arguments";
    let count = i32::from_ne_bytes(bytes.get(..4).ok_or(invalid)?.try_into().unwrap());
    if !(1..=4096).contains(&count) {
        return Err(invalid.into());
    }
    let mut remaining = &bytes[4..];
    let executable_end = remaining.iter().position(|b| *b == 0).ok_or(invalid)?;
    remaining = &remaining[executable_end + 1..];
    while remaining.first() == Some(&0) {
        remaining = &remaining[1..];
    }
    let mut args = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let end = remaining.iter().position(|b| *b == 0).ok_or(invalid)?;
        args.push(&remaining[..end]);
        remaining = &remaining[end + 1..];
    }
    Ok(args)
}

fn profile_argument<'a>(args: &[&'a [u8]]) -> Result<Option<&'a [u8]>, String> {
    let mut value = None;
    let mut args = args.iter().skip(1);
    while let Some(arg) = args.next() {
        let path = if *arg == b"--user-data-dir" {
            Some(*args.next().ok_or("Missing official App profile argument")?)
        } else {
            arg.strip_prefix(b"--user-data-dir=")
        };
        if let Some(path) = path {
            if path.is_empty() || value.replace(path).is_some() {
                return Err("Ambiguous official App profile arguments".into());
            }
        }
    }
    Ok(value)
}

fn owns_profile(args: &[&[u8]], profile: &Path) -> Result<bool, String> {
    use std::os::unix::ffi::OsStrExt;
    // Electron may reuse the main executable for helpers on some releases.
    if args
        .iter()
        .any(|arg| *arg == b"--type" || arg.starts_with(b"--type="))
    {
        return Ok(false);
    }
    let Some(argument) = profile_argument(args)? else {
        return Ok(false);
    };
    let argument = Path::new(std::ffi::OsStr::from_bytes(argument));
    Ok(argument == profile || argument.canonicalize().ok().as_deref() == Some(profile))
}

pub(super) fn executable(bundle: &Path) -> Result<PathBuf, String> {
    let value = plist::Value::from_file(bundle.join("Contents/Info.plist"))
        .map_err(|_| "Cannot read official App executable")?;
    let name = value
        .as_dictionary()
        .and_then(|info| info.get("CFBundleExecutable"))
        .and_then(plist::Value::as_string)
        .ok_or("Cannot identify official App executable")?;
    if name.is_empty() || name.contains('/') || matches!(name, "." | "..") {
        return Err("Invalid official App executable".into());
    }
    let path = bundle
        .join("Contents/MacOS")
        .join(name)
        .canonicalize()
        .map_err(|_| "Cannot resolve official App executable")?;
    if path.parent() != Some(bundle.join("Contents/MacOS").as_path()) {
        return Err("Official App executable is outside its bundle".into());
    }
    Ok(path)
}

pub(super) fn boot() -> Result<Vec<u8>, String> {
    let mut bytes = [0u8; 64];
    let mut size = bytes.len();
    // SAFETY: both buffers and lengths are valid for the synchronous sysctl.
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 || size == 0 || size > bytes.len() {
        return Err("Cannot verify official App launch boot identity".into());
    }
    Ok(bytes[..size].to_vec())
}

fn info(pid: i32) -> Result<Option<libc::proc_bsdinfo>, String> {
    let mut value = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    // SAFETY: correctly sized initialized POD output storage.
    let count = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            value.as_mut_ptr().cast(),
            size as i32,
        )
    };
    if count == size as i32 {
        return Ok(Some(unsafe { value.assume_init() }));
    }
    if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
        return Ok(None);
    }
    Err("Cannot verify official App process identity".into())
}

fn process_args(pid: i32) -> Result<Vec<u8>, String> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    // Darwin ARG_MAX is bounded; do not allocate from untrusted process data.
    let mut bytes = vec![0u8; 1024 * 1024];
    let mut size = bytes.len();
    let result = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 || size > bytes.len() {
        return Err("Cannot inspect official App arguments".into());
    }
    bytes.truncate(size);
    Ok(bytes)
}

fn unrelated_without_executable(bytes: Option<&[u8]>, profile: &Path) -> Result<bool, String> {
    match bytes {
        Some(bytes) => Ok(!owns_profile(&arguments(bytes)?, profile)?),
        None => Ok(false),
    }
}

/// `PROC_FLAG_INEXIT` (Darwin sys/proc_info.h): the process is inside exit().
const PROC_FLAG_INEXIT: u32 = 4;

/// Gone, a zombie, or already inside exit(): it cannot keep owning a profile.
/// The kernel reports zombies as ESRCH, which `info` already maps to `None`.
fn exiting(pid: i32) -> Result<bool, String> {
    Ok(match info(pid)? {
        None => true,
        Some(info) => info.pbi_status == libc::SZOMB || info.pbi_flags & PROC_FLAG_INEXIT != 0,
    })
}

/// One inspection pass either decides or finds the process unreadable.
enum Inspection {
    Decided(Option<Identity>),
    /// Kernel argv was unavailable while the process still looked alive. A
    /// process mid-`posix_spawn` already reports its parent's executable but
    /// has no argv yet, and one mid-exit loses argv before it is marked
    /// exiting; both settle within milliseconds.
    Unreadable(&'static str),
}

/// Bound on re-inspecting a process whose argv is momentarily unreadable.
const UNREADABLE_RETRIES: u32 = 50;
const UNREADABLE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(2);

/// Re-inspect from scratch (path included, since an exec may land between
/// passes) until the process is decided. One that stays unreadable is never
/// assumed unrelated.
fn settle(
    retries: u32,
    delay: std::time::Duration,
    mut inspect: impl FnMut() -> Result<Inspection, String>,
) -> Result<Option<Identity>, String> {
    let mut attempt = 0;
    loop {
        match inspect()? {
            Inspection::Decided(identity) => return Ok(identity),
            Inspection::Unreadable(error) if attempt >= retries => return Err(error.into()),
            Inspection::Unreadable(_) => {
                attempt += 1;
                std::thread::sleep(delay);
            }
        }
    }
}

fn matches(
    pid: i32,
    executable: &Path,
    profile: &Path,
    vendor_candidate: bool,
) -> Result<Option<Identity>, String> {
    settle(UNREADABLE_RETRIES, UNREADABLE_RETRY_DELAY, || {
        inspect(pid, executable, profile, vendor_candidate)
    })
}

fn inspect(
    pid: i32,
    executable: &Path,
    profile: &Path,
    vendor_candidate: bool,
) -> Result<Inspection, String> {
    use std::os::unix::ffi::OsStrExt;
    let mut path = [0u8; 4096];
    let size = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if size <= 0 {
        if exiting(pid)? {
            return Ok(Inspection::Decided(None));
        }
        // A live process whose executable was unlinked can lack a kernel
        // path (e.g. an updated CLI). Its kernel argv can still prove it does
        // not use this profile. Never infer unrelatedness from its name.
        if unrelated_without_executable(process_args(pid).ok().as_deref(), profile)? {
            return Ok(Inspection::Decided(None));
        }
        return Ok(Inspection::Unreadable(
            "Cannot inspect a running process while checking the official App",
        ));
    }
    let end = path.iter().position(|b| *b == 0).unwrap_or(path.len());
    let exact_executable = &path[..end] == executable.as_os_str().as_bytes();
    if !exact_executable && !vendor_candidate {
        return Ok(Inspection::Decided(None));
    }
    let Some(before) = info(pid)? else {
        return Ok(Inspection::Decided(None));
    };
    if before.pbi_uid != unsafe { libc::geteuid() } || before.pbi_status == libc::SZOMB {
        return Ok(Inspection::Decided(None));
    }
    const UNREADABLE: &str = "Cannot inspect official App arguments";
    let Ok(bytes) = process_args(pid) else {
        return Ok(if exiting(pid)? {
            Inspection::Decided(None)
        } else {
            Inspection::Unreadable(UNREADABLE)
        });
    };
    let Ok(args) = arguments(&bytes) else {
        return Ok(if exiting(pid)? {
            Inspection::Decided(None)
        } else {
            Inspection::Unreadable(UNREADABLE)
        });
    };
    if !owns_profile(&args, profile)? {
        return Ok(Inspection::Decided(None));
    }
    if !exact_executable {
        return Err("Another installed version of the official App uses this Package profile; quit that App normally before opening the selected version".into());
    }
    let identity = Identity {
        pid,
        started: (before.pbi_start_tvsec, before.pbi_start_tvusec),
    };
    let Some(after) = info(pid)? else {
        return Ok(Inspection::Decided(None));
    };
    if (after.pbi_start_tvsec, after.pbi_start_tvusec) != identity.started
        || after.pbi_uid != before.pbi_uid
    {
        return Err("Official App process changed during inspection".into());
    }
    Ok(Inspection::Decided(Some(identity)))
}

pub(super) fn find(
    executable: &Path,
    profile: &Path,
    bundle_id: &str,
) -> Result<Option<Identity>, String> {
    let apps = objc2_app_kit::NSRunningApplication::runningApplicationsWithBundleIdentifier(
        &objc2_foundation::NSString::from_str(bundle_id),
    );
    if apps.len() > 512 {
        return Err("Too many official App processes to verify safely".into());
    }
    let vendor_pids = apps
        .iter()
        .map(|app| app.processIdentifier())
        .collect::<Vec<_>>();
    // PROC_UID_ONLY (Darwin sys/proc_info.h): exclude unrelated users before inspection.
    const PROC_UID_ONLY: u32 = 4;
    let mut pids = vec![0i32; 65536];
    let capacity = std::mem::size_of_val(pids.as_slice());
    let bytes = unsafe {
        libc::proc_listpids(
            PROC_UID_ONLY,
            libc::geteuid(),
            pids.as_mut_ptr().cast(),
            capacity as i32,
        )
    };
    if bytes <= 0
        || bytes as usize >= capacity
        || !(bytes as usize).is_multiple_of(std::mem::size_of::<i32>())
    {
        return Err("Cannot enumerate official App processes".into());
    }
    pids.truncate(bytes as usize / std::mem::size_of::<i32>());
    let mut found = None;
    for pid in pids.into_iter().filter(|pid| *pid > 0) {
        if let Some(identity) = matches(pid, executable, profile, vendor_pids.contains(&pid))? {
            if found.replace(identity).is_some() {
                return Err("Multiple official App processes use this Package profile; quit the duplicate windows normally before opening again".into());
            }
        }
    }
    Ok(found)
}

fn verify(identity: &Identity, executable: &Path, profile: &Path) -> Result<(), String> {
    if matches(identity.pid, executable, profile, false)?.as_ref() != Some(identity) {
        return Err("Official App process changed before activation; retry Open".into());
    }
    Ok(())
}

const ACTIVATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const ACTIVATION_EXPIRED: &str = "Official App activation timed out; retry Open";

struct ActivationGate {
    deadline: std::time::Instant,
    cancelled: std::sync::atomic::AtomicBool,
}
impl ActivationGate {
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(std::sync::atomic::Ordering::Acquire)
            || std::time::Instant::now() >= self.deadline
        {
            Err(ACTIVATION_EXPIRED.into())
        } else {
            Ok(())
        }
    }
}

/// The worker holds the profile/config locks; the main callback must never
/// acquire those locks or wait for the worker. Timed-out queued work is inert.
fn activation_handoff(
    timeout: std::time::Duration,
    enqueue: impl FnOnce(Box<dyn FnOnce() + Send>),
    work: impl FnOnce(&ActivationGate) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let gate = std::sync::Arc::new(ActivationGate {
        deadline: std::time::Instant::now() + timeout,
        cancelled: std::sync::atomic::AtomicBool::new(false),
    });
    let queued_gate = gate.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    enqueue(Box::new(move || {
        let result = queued_gate.check().and_then(|()| work(&queued_gate));
        let _ = sender.send(result);
    }));
    let result = receiver
        .recv_timeout(
            gate.deadline
                .saturating_duration_since(std::time::Instant::now()),
        )
        .map_err(|_| ACTIVATION_EXPIRED.to_string());
    gate.cancelled
        .store(true, std::sync::atomic::Ordering::Release);
    result?
}

pub(super) fn activate(
    identity: &Identity,
    executable: &Path,
    profile: &Path,
    check_owner: impl Fn() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let identity = identity.clone();
    let executable = executable.to_owned();
    let profile = profile.to_owned();
    activation_handoff(
        ACTIVATION_TIMEOUT,
        |work| {
            if objc2::MainThreadMarker::new().is_some() {
                work();
            } else {
                dispatch2::DispatchQueue::main().exec_async(work);
                crate::infrastructure::main_runloop::wake_main_runloop();
            }
        },
        move |gate| {
            use objc2_app_kit::{
                NSApplication, NSApplicationActivationOptions, NSRunningApplication,
            };
            let main = objc2::MainThreadMarker::new()
                .ok_or("Official App activation requires the main thread")?;
            let app = NSRunningApplication::runningApplicationWithProcessIdentifier(identity.pid)
                .ok_or("Official App is still starting or has exited; retry Open")?;
            verify(&identity, &executable, &profile)?;
            check_owner()?;
            gate.check()?;
            let caller = NSRunningApplication::currentApplication();
            let allowed = if objc2::available!(macos = 14.0) {
                // IgnoringOtherApps has no effect since macOS 14. Cooperatively
                // yield from ORG2 to this exact instance, never a bundle-wide target.
                NSApplication::sharedApplication(main).yieldActivationToApplication(&app);
                app.activateFromApplication_options(
                    &caller,
                    NSApplicationActivationOptions::ActivateAllWindows,
                )
            } else {
                #[allow(deprecated)]
                let options = NSApplicationActivationOptions::ActivateAllWindows
                    | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
                app.activateWithOptions(options)
            };
            if !allowed {
                tracing::warn!(
                    target_pid = identity.pid,
                    caller_active = caller.isActive(),
                    target_active = app.isActive(),
                    target_finished_launching = app.isFinishedLaunching(),
                    "Official App activation request rejected"
                );
                return Err("Cannot activate the isolated official App; check its window".into());
            }
            // AppKit acknowledges the request, not rendered-window readiness.
            Ok(())
        },
    )
}

/// One bounded snapshot; no retries, signal, launch, or timer. All official
/// Claude writers are conservatively excluded because a CLI may override its
/// configuration root in an environment variable that must not be logged.
pub(super) fn claude_writers_closed() -> Result<(), &'static str> {
    if claude_writer_identities()?.is_empty() {
        Ok(())
    } else {
        Err("busy")
    }
}
pub(crate) fn writer_identity_current(identity: &Identity) -> Result<bool, &'static str> {
    Ok(info(identity.pid)
        .map_err(|_| "writer_unknown")?
        .is_some_and(|info| {
            info.pbi_uid == unsafe { libc::geteuid() }
                && (info.pbi_start_tvsec, info.pbi_start_tvusec) == identity.started
                && info.pbi_status != libc::SZOMB
                && info.pbi_flags & PROC_FLAG_INEXIT == 0
        }))
}
pub(crate) fn claude_writer_identities() -> Result<Vec<Identity>, &'static str> {
    let apps = objc2_app_kit::NSRunningApplication::runningApplicationsWithBundleIdentifier(
        &objc2_foundation::NSString::from_str("com.anthropic.claudefordesktop"),
    );
    let app_pids: Vec<_> = apps.iter().map(|app| app.processIdentifier()).collect();
    let mut writers = Vec::new();
    const PROC_UID_ONLY: u32 = 4;
    let mut pids = vec![0i32; 65536];
    let capacity = std::mem::size_of_val(pids.as_slice());
    let bytes = unsafe {
        libc::proc_listpids(
            PROC_UID_ONLY,
            libc::geteuid(),
            pids.as_mut_ptr().cast(),
            capacity as i32,
        )
    };
    if bytes <= 0
        || bytes as usize >= capacity
        || !(bytes as usize).is_multiple_of(std::mem::size_of::<i32>())
    {
        return Err("writer_unknown");
    }
    pids.truncate(bytes as usize / std::mem::size_of::<i32>());
    for pid in pids.into_iter().filter(|pid| *pid > 0) {
        let Some(before) = info(pid).map_err(|_| "writer_unknown")? else {
            continue;
        };
        if before.pbi_status == libc::SZOMB || before.pbi_flags & PROC_FLAG_INEXIT != 0 {
            continue;
        }
        let mut path = [0u8; 4096];
        let len = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
        if len <= 0 {
            return Err("writer_unknown");
        }
        let end = path
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(path.len());
        let executable = std::str::from_utf8(&path[..end]).map_err(|_| "writer_unknown")?;
        let name = Path::new(executable)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("writer_unknown")?;
        let mut writer = app_pids.contains(&pid) || claude_executable(executable);
        if matches!(name, "node" | "nodejs" | "bun" | "deno") {
            let bytes = process_args(pid).map_err(|_| "writer_unknown")?;
            let args = arguments(&bytes).map_err(|_| "writer_unknown")?;
            if args
                .iter()
                .any(|arg| std::str::from_utf8(arg).is_ok_and(claude_executable))
            {
                writer = true;
            }
        }
        let Some(after) = info(pid).map_err(|_| "writer_unknown")? else {
            continue;
        };
        if (before.pbi_start_tvsec, before.pbi_start_tvusec)
            != (after.pbi_start_tvsec, after.pbi_start_tvusec)
            || before.pbi_uid != after.pbi_uid
        {
            return Err("writer_unknown");
        }
        if writer {
            if writers.len() >= 512 {
                return Err("writer_unknown");
            }
            writers.push(Identity {
                pid,
                started: (after.pbi_start_tvsec, after.pbi_start_tvusec),
            });
        }
    }
    Ok(writers)
}
fn claude_executable(path: &str) -> bool {
    // Installed browser native messaging host only writes its bridge socket/log;
    // it is not Desktop or a CLI writer. Keep scanning every other process and
    // all child CLI entrypoints, including other Helpers and copied app bundles.
    if path == "/Applications/Claude.app/Contents/Helpers/chrome-native-host" {
        return false;
    }
    matches!(
        Path::new(path).file_name().and_then(|value| value.to_str()),
        Some("claude" | "claude.exe" | "Claude")
    ) || path.contains("/@anthropic-ai/claude-code/")
        || path.contains("/Claude.app/Contents/")
}

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
