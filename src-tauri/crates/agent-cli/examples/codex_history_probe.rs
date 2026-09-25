//! Native regression driver. Only operates inside an explicitly marked,
//! disposable probe root; never resolves the user's normal Codex/ORG2 home.
//! Its check authorizes this synthetic candidate experiment only. Passing does
//! not grant a production binary capability or certify native GUI isolation.
#[cfg(unix)]
mod native_probe {
    use agent_cli::managed_config::native_app::{codex_history, NativeAppProfile};
    use serde_json::json;
    use std::path::{Path, PathBuf};

    const MARKER: &str = "ORG2_CODEX_HISTORY_NATIVE_PROBE_V1\n";

    fn guarded_root() -> Result<PathBuf, String> {
        let root = PathBuf::from(
            std::env::var_os("ORGII_CODEX_HISTORY_PROBE_ROOT").ok_or("Missing probe root")?,
        );
        if !root.is_absolute() || root.canonicalize().map_err(|_| "Probe root must exist")? != root
        {
            return Err("Probe root must be a canonical absolute directory".into());
        }
        let marker = root.join(".codex-history-probe-root");
        let metadata = std::fs::symlink_metadata(&marker).map_err(|_| "Missing probe marker")?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != MARKER.len() as u64
            || std::fs::read_to_string(marker).map_err(|_| "Cannot read probe marker")? != MARKER
        {
            return Err("Invalid probe root marker".into());
        }
        for (name, relative) in [
            ("ORGII_HOME", "orgii"),
            ("ORGII_NATIVE_TRANSCRIPT_HOME", "primary-account"),
            ("HOME", "system-home"),
        ] {
            let configured =
                std::env::var_os(name).ok_or_else(|| format!("Missing {name} override"))?;
            if Path::new(&configured) != root.join(relative) {
                return Err(format!("{name} must point inside this probe root"));
            }
        }
        Ok(root)
    }

    fn run() -> Result<(), String> {
        let root = guarded_root()?;
        let profile = NativeAppProfile::new(
            "codex",
            "https://codex-history-probe.invalid",
            "native-probe-owner",
        )?;
        if !profile.home().starts_with(root.join("orgii")) {
            return Err("Native profile escaped probe root".into());
        }
        match std::env::args().nth(1).as_deref() {
            Some("paths") => {
                profile.prepare_launch_directories()?;
                println!(
                    "{}",
                    json!({
                        "primary":root.join("primary-account/.codex"),
                        "package":profile.home(),
                        "journal":profile.root().join("codex-history/state.json")
                    })
                );
            }
            Some("reconcile") => {
                let report = codex_history::reconcile(&profile, None, || {
                    guarded_root().and_then(|current| {
                        if current == root {
                            Ok(())
                        } else {
                            Err("Probe owner changed".into())
                        }
                    })
                })?;
                println!(
                    "{}",
                    json!({"copied":report.copied,"busy":report.busy,"conflicts":report.conflicts,"more":report.more})
                );
            }
            _ => return Err("Usage: codex_history_probe paths|reconcile".into()),
        }
        Ok(())
    }

    pub fn main() {
        if let Err(error) = run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn main() {
    #[cfg(unix)]
    native_probe::main();
    #[cfg(not(unix))]
    {
        eprintln!("This native history probe requires an audited Unix environment");
        std::process::exit(2);
    }
}
