//! Observe the managed GUI's real stdio child. Environment values are intent,
//! never evidence. Snapshots are scoped to one owner/profile, with no idle work.
use super::{
    arguments, exec_generation, info, process_args, ExecGeneration, Identity, ProfileBinding,
    PROC_FLAG_INEXIT,
};
use crate::market_connection::native_compatibility::ResolvedNativeClient;
use agent_cli::managed_config::native_app::NativeAppProfile;
use std::path::Path;

const UNKNOWN: &str = "native_runtime_unverified";
const MISMATCH: &str = "native_runtime_mismatch";
const MAX_CHILDREN: usize = 512;

#[derive(Clone)]
pub(crate) struct Binding {
    gui: Identity,
    gui_exec: ExecGeneration,
    core: Identity,
    core_exec: ExecGeneration,
    children: Vec<i32>,
    environment: Option<super::profile::ExpectedEnvironment>,
}

/// A closed managed GUI permits offline history work. The registered vendor
/// process set is rechecked at every write fence, so a new instance invalidates
/// the snapshot. The caller also holds the managed profile/configuration lock.
#[derive(Clone)]
pub(crate) struct ProfileRuntime {
    generation: String,
    profile: NativeAppProfile,
    registered: Vec<Identity>,
    binding: Option<ProfileBinding>,
}

fn live(value: &libc::proc_bsdinfo) -> bool {
    value.pbi_uid == unsafe { libc::geteuid() }
        && value.pbi_status != libc::SZOMB
        && value.pbi_flags & PROC_FLAG_INEXIT == 0
}

fn identity(pid: i32, value: &libc::proc_bsdinfo) -> Identity {
    Identity {
        pid,
        started: (value.pbi_start_tvsec, value.pbi_start_tvusec),
    }
}

fn executable_matches(pid: i32, expected: &Path) -> Result<bool, String> {
    use std::os::unix::ffi::OsStrExt;
    let mut bytes = [0u8; 4096];
    let size = unsafe { libc::proc_pidpath(pid, bytes.as_mut_ptr().cast(), bytes.len() as u32) };
    if size <= 0 || size as usize >= bytes.len() {
        return Err(UNKNOWN.into());
    }
    let end = bytes.iter().position(|v| *v == 0).ok_or(UNKNOWN)?;
    Ok(&bytes[..end] == expected.as_os_str().as_bytes())
}

fn verify_identity(value: &Identity, expected: &Path, parent: Option<i32>) -> Result<(), String> {
    let before = info(value.pid).map_err(|_| UNKNOWN)?.ok_or(UNKNOWN)?;
    if !live(&before)
        || identity(value.pid, &before) != *value
        || parent.is_some_and(|pid| before.pbi_ppid != pid as u32)
    {
        return Err(UNKNOWN.into());
    }
    if !executable_matches(value.pid, expected)? {
        return Err(MISMATCH.into());
    }
    let after = info(value.pid).map_err(|_| UNKNOWN)?.ok_or(UNKNOWN)?;
    if !live(&after) || identity(value.pid, &after) != *value || before.pbi_ppid != after.pbi_ppid {
        return Err(UNKNOWN.into());
    }
    Ok(())
}

fn children(pid: i32) -> Result<Vec<i32>, String> {
    // PROC_PPID_ONLY returns bytes, unlike proc_listchildpids' count contract.
    const PROC_PPID_ONLY: u32 = 6;
    let mut pids = vec![0i32; MAX_CHILDREN + 1];
    let capacity = std::mem::size_of_val(pids.as_slice());
    let count = unsafe {
        libc::proc_listpids(
            PROC_PPID_ONLY,
            pid as u32,
            pids.as_mut_ptr().cast(),
            capacity as i32,
        )
    };
    if count < 0 || count as usize >= capacity || !(count as usize).is_multiple_of(4) {
        return Err(UNKNOWN.into());
    }
    pids.truncate(count as usize / 4);
    pids.retain(|pid| *pid > 0);
    pids.sort_unstable();
    if pids.len() > MAX_CHILDREN {
        return Err(UNKNOWN.into());
    }
    Ok(pids)
}

/// The local GUI's stdio resolver uses global -c/--config options followed by
/// app-server. A helper or a shell argument merely containing that text cannot
/// become runtime evidence. Unknown CLI options fail closed at this boundary.
fn app_server(args: &[&[u8]]) -> bool {
    let mut args = args.iter().skip(1);
    let mut server = false;
    while let Some(arg) = args.next() {
        match *arg {
            b"-c" | b"--config" | b"--enable" | b"--disable" => {
                if args.next().is_none() {
                    return false;
                }
            }
            b"app-server" if !server => server = true,
            b"--analytics-default-enabled" if server => {}
            arg if arg.starts_with(b"--config=")
                || arg.starts_with(b"--enable=")
                || arg.starts_with(b"--disable=") => {}
            _ => return false,
        }
    }
    server
}

/// The managed config remains authoritative. Inspect the real invocation, not
/// its vendor version, and allow only non-routing options whose value shape is
/// understood here. New routing/profile/credential overrides need an explicit
/// operation-level check rather than bypassing the locked managed config.
fn managed_invocation(args: &[&[u8]]) -> Result<(), String> {
    const INVALID: &str = "native_runtime_invocation_unverified";
    if !app_server(args) {
        return Err(INVALID.into());
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut args = args.iter().skip(1);
    while let Some(arg) = args.next() {
        let setting = match *arg {
            b"-c" | b"--config" => *args.next().ok_or(INVALID)?,
            b"app-server" => continue,
            b"--analytics-default-enabled" => {
                if !seen.insert("analytics-default-enabled".to_string()) {
                    return Err(INVALID.into());
                }
                continue;
            }
            arg if arg.starts_with(b"--config=") => &arg[b"--config=".len()..],
            // --enable/--disable are config overrides too. The managed GUI
            // uses explicit typed config assignments; don't silently infer
            // semantics for a new switch or unknown feature.
            _ => return Err(INVALID.into()),
        };
        let text = std::str::from_utf8(setting).map_err(|_| INVALID)?;
        if text.len() > 4096 {
            return Err(INVALID.into());
        }
        let table: toml::Table = toml::from_str(text).map_err(|_| INVALID)?;
        let (key, value) = single_setting(&table).ok_or(INVALID)?;
        if !seen.insert(key.clone()) {
            return Err(INVALID.into());
        }
        let safe = match key.as_str() {
            "features.code_mode_host" | "analytics.enabled" => value.is_bool(),
            "otel.environment" => value.is_str(),
            _ => false,
        };
        if !safe {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

fn single_setting(table: &toml::Table) -> Option<(String, &toml::Value)> {
    if table.len() != 1 {
        return None;
    }
    let (key, value) = table.iter().next()?;
    if !key
        .bytes()
        .all(|value| value.is_ascii_alphanumeric() || value == b'_')
    {
        return None;
    }
    if let Some(table) = value.as_table() {
        let (child, value) = single_setting(table)?;
        Some((format!("{key}.{child}"), value))
    } else {
        Some((key.clone(), value))
    }
}

fn select_core(
    gui: &Identity,
    expected: &Path,
    pids: &[i32],
) -> Result<Option<(Identity, ExecGeneration)>, String> {
    let mut found = None;
    for &pid in pids {
        let generation = exec_generation(pid).map_err(|_| UNKNOWN)?;
        let Some(before) = info(pid).map_err(|_| UNKNOWN)? else {
            return Err(UNKNOWN.into());
        };
        if !live(&before) || before.pbi_ppid != gui.pid as u32 {
            return Err(UNKNOWN.into());
        }
        let bytes = process_args(pid).map_err(|_| UNKNOWN)?;
        let args = arguments(&bytes).map_err(|_| UNKNOWN)?;
        if !app_server(&args) {
            continue;
        }
        let core = identity(pid, &before);
        verify_identity(&core, expected, Some(gui.pid))?;
        if generation != exec_generation(pid).map_err(|_| UNKNOWN)? {
            return Err(UNKNOWN.into());
        }
        if found.replace((core, generation)).is_some() {
            return Err(UNKNOWN.into());
        }
    }
    Ok(found)
}

pub(crate) fn observe(
    client: &ResolvedNativeClient,
    gui: &Identity,
) -> Result<Option<Binding>, String> {
    client.artifacts_predate(gui.started)?;
    let Some(binding) = observe_processes(gui, &client.executable, client.runtime()?)? else {
        return Ok(None);
    };
    binding.check(client)?;
    Ok(Some(binding))
}

fn observe_processes(
    gui: &Identity,
    executable: &Path,
    runtime: &Path,
) -> Result<Option<Binding>, String> {
    let gui_exec = exec_generation(gui.pid).map_err(|_| UNKNOWN)?;
    verify_identity(gui, executable, None)?;
    let pids = children(gui.pid)?;
    let Some((core, core_exec)) = select_core(gui, runtime, &pids)? else {
        return Ok(None);
    };
    let binding = Binding {
        gui: gui.clone(),
        gui_exec,
        core_exec,
        core,
        children: pids,
        environment: None,
    };
    binding.check_processes(executable, runtime)?;
    Ok(Some(binding))
}

impl Binding {
    pub(super) fn bind_profile(
        &mut self,
        environment: super::profile::ExpectedEnvironment,
    ) -> Result<(), String> {
        let before = exec_generation(self.core.pid).map_err(|_| UNKNOWN)?;
        managed_invocation(
            &arguments(&process_args(self.core.pid).map_err(|_| UNKNOWN)?).map_err(|_| UNKNOWN)?,
        )?;
        environment.check(self.core.pid)?;
        if before != self.core_exec
            || exec_generation(self.core.pid).map_err(|_| UNKNOWN)? != before
        {
            return Err(UNKNOWN.into());
        }
        self.environment = Some(environment);
        Ok(())
    }

    pub(crate) fn check(&self, client: &ResolvedNativeClient) -> Result<(), String> {
        client.artifacts_predate(self.gui.started)?;
        client.artifacts_predate(self.core.started)?;
        self.check_processes(&client.executable, client.runtime()?)
    }

    fn check_processes(&self, executable: &Path, runtime: &Path) -> Result<(), String> {
        if exec_generation(self.gui.pid).map_err(|_| UNKNOWN)? != self.gui_exec
            || exec_generation(self.core.pid).map_err(|_| UNKNOWN)? != self.core_exec
        {
            return Err(UNKNOWN.into());
        }
        verify_identity(&self.gui, executable, None)?;
        verify_identity(&self.core, runtime, Some(self.gui.pid))?;
        if let Some(environment) = &self.environment {
            environment.check(self.core.pid)?;
        }
        // A restart or additional child needs fresh classification. No process
        // is signalled, and no absence/mismatch is interpreted as permission.
        if children(self.gui.pid)? != self.children
            || exec_generation(self.gui.pid).map_err(|_| UNKNOWN)? != self.gui_exec
            || exec_generation(self.core.pid).map_err(|_| UNKNOWN)? != self.core_exec
        {
            return Err(UNKNOWN.into());
        }
        Ok(())
    }
}

fn registered() -> Result<Vec<Identity>, String> {
    let apps = objc2_app_kit::NSRunningApplication::runningApplicationsWithBundleIdentifier(
        &objc2_foundation::NSString::from_str("com.openai.codex"),
    );
    if apps.len() > MAX_CHILDREN {
        return Err(UNKNOWN.into());
    }
    let mut values = Vec::with_capacity(apps.len());
    for app in apps.iter() {
        let pid = app.processIdentifier();
        let value = info(pid).map_err(|_| UNKNOWN)?.ok_or(UNKNOWN)?;
        if live(&value) {
            values.push(identity(pid, &value));
        }
    }
    values.sort_by_key(|value| value.pid);
    Ok(values)
}

impl ProfileRuntime {
    pub(crate) fn is_bound(&self) -> bool {
        self.binding.is_some()
    }

    pub(crate) fn capture(
        client: &ResolvedNativeClient,
        profile: &NativeAppProfile,
    ) -> Result<Self, String> {
        profile.validate("codex")?;
        let user_data = match profile.user_data().canonicalize() {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => profile.user_data(),
            Err(_) => return Err(UNKNOWN.into()),
        };
        let before = registered()?;
        let gui =
            super::find(&client.executable, &user_data, "com.openai.codex").map_err(|_| UNKNOWN)?;
        let binding = gui
            .as_ref()
            .map(|gui| {
                ProfileBinding::observe(client, gui, profile)
                    .and_then(|value| value.ok_or_else(|| UNKNOWN.into()))
            })
            .transpose()?;
        let snapshot = Self {
            generation: client.generation.clone(),
            profile: profile.clone(),
            registered: before,
            binding,
        };
        snapshot.check(client, profile)?;
        Ok(snapshot)
    }

    pub(crate) fn check(
        &self,
        client: &ResolvedNativeClient,
        profile: &NativeAppProfile,
    ) -> Result<(), String> {
        client.ensure_current()?;
        if self.generation != client.generation
            || &self.profile != profile
            || registered()? != self.registered
        {
            return Err(UNKNOWN.into());
        }
        if let Some(binding) = &self.binding {
            binding.check(client)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "process_codex_runtime_tests.rs"]
mod tests;
