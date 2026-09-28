//! Verify the process that received a managed profile, independently of its
//! version. Kernel launch environment is not proof of rendered UI, model
//! routing, or OS confinement; those need their own operation-level evidence.
use super::{
    codex_runtime, exec_generation, kernel_arguments, process_args, ExecGeneration, Identity,
};
use crate::market_connection::native_compatibility::ResolvedNativeClient;
use agent_cli::managed_config::native_app::NativeAppProfile;
use std::{os::unix::ffi::OsStrExt, path::Path};

const UNKNOWN: &str = "native_profile_runtime_unverified";
const MISMATCH: &str = "native_profile_runtime_mismatch";

#[derive(Clone)]
enum ExpectedValue {
    Exact(Vec<u8>),
    AbsentOrEmpty,
}

/// Only the selectors ORG2 controls are retained. Other environment entries,
/// including credentials, are neither copied into this object nor reported.
#[derive(Clone)]
pub(super) struct ExpectedEnvironment(Vec<(&'static str, ExpectedValue)>);

impl ExpectedEnvironment {
    fn common(profile: &NativeAppProfile) -> Result<Self, String> {
        profile.validate(profile.agent())?;
        let mut value = Self(Vec::new());
        value.path("HOME", &super::super::account_home::resolve()?)?;
        value.path("CFFIXED_USER_HOME", &profile.system_home())?;
        value.path("CLAUDE_CONFIG_DIR", &profile.system_home().join(".claude"))?;
        for &name in super::super::CLEARED_ENVIRONMENT {
            value.0.push((name, ExpectedValue::AbsentOrEmpty));
        }
        Ok(value)
    }

    fn gui(profile: &NativeAppProfile, client: &ResolvedNativeClient) -> Result<Self, String> {
        if profile.agent() != client.agent {
            return Err(MISMATCH.into());
        }
        let mut value = Self::common(profile)?;
        match profile.agent() {
            "claude_desktop" => {}
            "codex" => {
                value.path("CODEX_HOME", &profile.home())?;
                value.path("CODEX_SQLITE_HOME", &profile.home())?;
                value.path("CODEX_ELECTRON_USER_DATA_PATH", &profile.user_data())?;
                value.path("CODEX_CLI_PATH", client.runtime()?)?;
                value.exact("CODEX_APP_SERVER_FORCE_CLI", b"1");
                value.exact("CODEX_APP_SERVER_USE_LOCAL_DAEMON", b"0");
            }
            _ => return Err(UNKNOWN.into()),
        }
        Ok(value)
    }

    pub(super) fn core(profile: &NativeAppProfile) -> Result<Self, String> {
        if profile.agent() != "codex" {
            return Err(MISMATCH.into());
        }
        let mut value = Self::common(profile)?;
        value.path("CODEX_HOME", &profile.home())?;
        value.path("CODEX_SQLITE_HOME", &profile.home())?;
        Ok(value)
    }

    fn path(&mut self, name: &'static str, path: &Path) -> Result<(), String> {
        if !path.is_absolute() {
            return Err(UNKNOWN.into());
        }
        self.exact(name, path.as_os_str().as_bytes());
        Ok(())
    }

    fn exact(&mut self, name: &'static str, value: &[u8]) {
        self.0.push((name, ExpectedValue::Exact(value.to_vec())));
    }

    fn check_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        let kernel = kernel_arguments(bytes).map_err(|_| UNKNOWN)?;
        let mut seen = vec![false; self.0.len()];
        let mut remaining = kernel.environment;
        let mut entries = 0;
        while !remaining.is_empty() {
            let end = remaining
                .iter()
                .position(|value| *value == 0)
                .ok_or(UNKNOWN)?;
            let entry = &remaining[..end];
            remaining = &remaining[end + 1..];
            if entry.is_empty() {
                // Darwin may append its Apple auxiliary vector after the
                // environment terminator (for example executable_file=...).
                // Those entries are not environment, even if their names
                // happen to resemble one of the selectors being checked.
                break;
            }
            entries += 1;
            if entries > 4096 {
                return Err(UNKNOWN.into());
            }
            let separator = entry
                .iter()
                .position(|value| *value == b'=')
                .ok_or(UNKNOWN)?;
            let name = &entry[..separator];
            if name.is_empty() {
                return Err(UNKNOWN.into());
            }
            let Some(index) = self.0.iter().position(|(key, _)| key.as_bytes() == name) else {
                continue;
            };
            if std::mem::replace(&mut seen[index], true) {
                return Err(UNKNOWN.into());
            }
            let actual = &entry[separator + 1..];
            let matches = match &self.0[index].1 {
                ExpectedValue::Exact(expected) => actual == expected,
                ExpectedValue::AbsentOrEmpty => actual.is_empty(),
            };
            if !matches {
                return Err(MISMATCH.into());
            }
        }
        if self
            .0
            .iter()
            .zip(seen)
            .any(|((_, value), seen)| matches!(value, ExpectedValue::Exact(_)) && !seen)
        {
            return Err(UNKNOWN.into());
        }
        Ok(())
    }

    pub(super) fn check(&self, pid: i32) -> Result<(), String> {
        self.check_bytes(&process_args(pid).map_err(|_| UNKNOWN)?)
    }
}

#[derive(Clone)]
pub(crate) struct ProfileBinding {
    generation: String,
    gui: Identity,
    gui_exec: ExecGeneration,
    profile: NativeAppProfile,
    environment: ExpectedEnvironment,
    core: Option<codex_runtime::Binding>,
}

impl ProfileBinding {
    pub(crate) fn observe(
        client: &ResolvedNativeClient,
        gui: &Identity,
        profile: &NativeAppProfile,
    ) -> Result<Option<Self>, String> {
        let environment = ExpectedEnvironment::gui(profile, client)?;
        let gui_exec = exec_generation(gui.pid).map_err(|_| UNKNOWN)?;
        let mut value = Self {
            generation: client.generation.clone(),
            gui: gui.clone(),
            gui_exec,
            profile: profile.clone(),
            environment,
            core: None,
        };
        value.check(client)?;
        if client.agent == "codex" {
            let Some(mut core) = codex_runtime::observe(client, gui)? else {
                return Ok(None);
            };
            core.bind_profile(ExpectedEnvironment::core(profile)?)?;
            value.core = Some(core);
        }
        value.check(client)?;
        Ok(Some(value))
    }

    pub(crate) fn check(&self, client: &ResolvedNativeClient) -> Result<(), String> {
        client.artifacts_predate(self.gui.started)?;
        if client.generation != self.generation || client.agent != self.profile.agent() {
            return Err(MISMATCH.into());
        }
        self.profile.validate(&client.agent)?;
        let user_data = self
            .profile
            .user_data()
            .canonicalize()
            .map_err(|_| UNKNOWN)?;
        let before = exec_generation(self.gui.pid).map_err(|_| UNKNOWN)?;
        super::verify(&self.gui, &client.executable, &user_data).map_err(|_| UNKNOWN)?;
        let bytes = process_args(self.gui.pid).map_err(|_| UNKNOWN)?;
        let kernel = kernel_arguments(&bytes).map_err(|_| UNKNOWN)?;
        if !super::same_kernel_executable(
            kernel.executable,
            client.executable.as_os_str().as_bytes(),
        ) {
            return Err(MISMATCH.into());
        }
        self.environment.check_bytes(&bytes)?;
        super::verify(&self.gui, &client.executable, &user_data).map_err(|_| UNKNOWN)?;
        let after = exec_generation(self.gui.pid).map_err(|_| UNKNOWN)?;
        check_generation(self.gui_exec, before, after)?;
        if let Some(core) = &self.core {
            core.check(client)?;
        }
        Ok(())
    }
}

fn check_generation(
    captured: ExecGeneration,
    before: ExecGeneration,
    after: ExecGeneration,
) -> Result<(), String> {
    if captured != before || before != after {
        return Err(UNKNOWN.into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "process_profile_tests.rs"]
mod tests;
