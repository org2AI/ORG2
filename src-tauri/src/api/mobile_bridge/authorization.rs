//! Revocable authorization for LAN connections. Settings events, rather than
//! per-request disk reads or polling, invalidate every lease from an old epoch.

use std::sync::OnceLock;

use tokio::sync::watch;

use super::auth::{self, AuthFailure, MobileRemoteSettings};

struct State {
    settings: MobileRemoteSettings,
    generation: u64,
}

#[derive(Clone)]
pub(super) struct Authority(watch::Sender<State>);

#[derive(Clone)]
pub struct LanLease {
    authority: Authority,
    generation: u64,
}

impl Authority {
    pub(super) fn new(settings: MobileRemoteSettings) -> Self {
        Self(
            watch::channel(State {
                settings,
                generation: 0,
            })
            .0,
        )
    }

    pub(super) fn update(&self, settings: MobileRemoteSettings) {
        self.0.send_if_modified(|state| {
            if state.settings == settings {
                return false;
            }
            state.settings = settings;
            // Changing away and back must never resurrect an old connection.
            state.generation = state.generation.wrapping_add(1);
            true
        });
    }

    #[cfg(test)]
    pub(super) fn authorize(
        &self,
        token: &str,
    ) -> Result<(MobileRemoteSettings, LanLease), AuthFailure> {
        self.authorize_with_settings(token, || self.0.borrow().settings.clone())
    }

    fn authorize_with_settings(
        &self,
        token: &str,
        load: impl Fn() -> MobileRemoteSettings,
    ) -> Result<(MobileRemoteSettings, LanLease), AuthFailure> {
        loop {
            let generation = self.0.borrow().generation;
            // Reading can recover a file and publish settings changes. Hold no
            // watch lock across I/O, and discard a read superseded by an event.
            let settings = load();
            auth::validate_token_against_settings(token, &settings)?;
            auth::check_bridge_available(&settings)?;
            let mut grant = None;
            self.0.send_if_modified(|state| {
                if state.generation != generation {
                    return false;
                }
                let changed = state.settings != settings;
                if changed {
                    state.settings = settings.clone();
                    state.generation = state.generation.wrapping_add(1);
                }
                // Record the grant's source settings, including the first
                // handshake before a hook has ever fired. A later default/empty
                // settings event must revoke that initial connection too.
                grant = Some((
                    settings.clone(),
                    LanLease {
                        authority: self.clone(),
                        generation: state.generation,
                    },
                ));
                changed
            });
            if let Some(grant) = grant {
                return Ok(grant);
            }
        }
    }
}

impl LanLease {
    pub fn is_current(&self) -> bool {
        self.authority.0.borrow().generation == self.generation
    }

    pub(super) async fn revoked(&self) {
        let mut changes = self.authority.0.subscribe();
        loop {
            if changes.borrow_and_update().generation != self.generation {
                return;
            }
            if changes.changed().await.is_err() {
                return;
            }
        }
    }
}

static AUTHORITY: OnceLock<Authority> = OnceLock::new();

pub(super) fn authorize(token: &str) -> Result<(MobileRemoteSettings, LanLease), AuthFailure> {
    // A fresh handshake reads disk, so delayed events cannot grant access from
    // stale settings. Existing connections use their event-driven lease only.
    AUTHORITY
        .get_or_init(|| Authority::new(MobileRemoteSettings::default()))
        .authorize_with_settings(token, auth::load_settings)
}

pub(crate) fn notify_settings_changed(value: &serde_json::Value) {
    let settings = auth::settings_from_value(value);
    AUTHORITY
        .get_or_init(|| Authority::new(settings.clone()))
        .update(settings);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> MobileRemoteSettings {
        MobileRemoteSettings {
            enabled: true,
            lan_token: "test-token".into(),
            allow_lan_exposure: true,
        }
    }

    #[tokio::test]
    async fn changes_revoke_leases_even_before_the_watcher_is_polled() {
        for next in [
            MobileRemoteSettings {
                enabled: false,
                ..settings()
            },
            MobileRemoteSettings {
                lan_token: "rotated".into(),
                ..settings()
            },
            MobileRemoteSettings {
                allow_lan_exposure: false,
                ..settings()
            },
        ] {
            let authority = Authority::new(settings());
            let (_, lease) = authority.authorize("test-token").unwrap();
            authority.update(next);
            authority.update(settings());
            assert!(!lease.is_current());
            tokio::time::timeout(std::time::Duration::from_secs(1), lease.revoked())
                .await
                .unwrap();
            assert!(authority.authorize("test-token").unwrap().1.is_current());
        }
    }

    #[test]
    fn initial_disk_grant_is_revoked_when_settings_are_deleted_or_unreadable() {
        let authority = Authority::new(MobileRemoteSettings::default());
        let (_, lease) = authority
            .authorize_with_settings("test-token", settings)
            .unwrap();
        assert!(lease.is_current());
        authority.update(MobileRemoteSettings::default());
        assert!(!lease.is_current());
    }

    #[test]
    fn settings_event_during_disk_read_forces_a_fresh_authorization_read() {
        let authority = Authority::new(settings());
        let reads = std::cell::Cell::new(0);
        let result = authority.authorize_with_settings("test-token", || {
            reads.set(reads.get() + 1);
            if reads.get() == 1 {
                authority.update(MobileRemoteSettings::default());
                settings()
            } else {
                MobileRemoteSettings::default()
            }
        });
        assert!(matches!(result, Err(AuthFailure::FeatureDisabled)));
        assert_eq!(reads.get(), 2);
    }

    #[test]
    fn unrelated_settings_events_preserve_the_lease() {
        let authority = Authority::new(settings());
        let (_, lease) = authority.authorize("test-token").unwrap();
        authority.update(settings());
        assert!(lease.is_current());
    }
}
