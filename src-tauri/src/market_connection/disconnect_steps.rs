//! Callers hold connection locks. Each cleanup effect is idempotent so a
//! failure after an earlier effect committed can be safely retried.
pub(super) fn disconnect_steps(
    restore: impl FnOnce() -> Result<(), String>,
    remove_grant: impl FnOnce() -> Result<(), String>,
    remove_index: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    restore()?;
    remove_grant()?;
    remove_index()
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn every_cleanup_stage_can_fail_before_or_after_its_write_and_then_retry() {
        for failed_stage in 0..3 {
            for after_write in [false, true] {
                let directory = tempfile::tempdir().unwrap();
                let config = directory.path().join("config");
                let grant = directory.path().join("credential-store-entry");
                let index = directory.path().join("index.json");
                fs::write(&config, "market-selected").unwrap();
                fs::write(&grant, "synthetic-grant").unwrap();
                fs::write(&index, r#"["market","other"]"#).unwrap();
                let run = |inject: bool| {
                    let step = |stage: usize, effect: &dyn Fn() -> Result<(), String>| {
                        if inject && failed_stage == stage && !after_write {
                            return Err("injected failure".into());
                        }
                        effect()?;
                        if inject && failed_stage == stage && after_write {
                            return Err("injected failure".into());
                        }
                        Ok(())
                    };
                    disconnect_steps(
                        || {
                            step(0, &|| {
                                if fs::read_to_string(&config).unwrap() == "market-selected" {
                                    fs::write(&config, "default").map_err(|e| e.to_string())?;
                                }
                                Ok(())
                            })
                        },
                        || {
                            step(1, &|| match fs::remove_file(&grant) {
                                Ok(()) => Ok(()),
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                                Err(e) => Err(e.to_string()),
                            })
                        },
                        || {
                            step(2, &|| {
                                agent_cli::managed_config::write_cli_profile_file_atomic(
                                    &index,
                                    br#"["other"]"#,
                                )
                            })
                        },
                    )
                };
                assert!(run(true).is_err());
                if failed_stage == 0 {
                    assert!(grant.exists());
                }
                fs::write(&config, "new-user-selection").unwrap();
                run(false).unwrap();
                run(false).unwrap();
                assert_eq!(fs::read_to_string(&config).unwrap(), "new-user-selection");
                assert!(!grant.exists());
                assert_eq!(fs::read_to_string(&index).unwrap(), r#"["other"]"#);
            }
        }
    }
}
