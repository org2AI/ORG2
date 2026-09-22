//! Canonical resolver for the Cursor app's own on-disk storage locations.
//!
//! Where the Cursor IDE / CLI keep their data (ORGII only ever reads these
//! locations):
//!
//! - **IDE user data** hangs off the platform config root — macOS
//!   `~/Library/Application Support/Cursor/`, Linux `$XDG_CONFIG_HOME/Cursor/`
//!   (default `~/.config/Cursor/`), Windows `%APPDATA%\Cursor\`.
//! - **CLI / plugin data** lives in the home-anchored dotdir `~/.cursor/` on
//!   every platform.
//!
//! Not to be confused with the ORGII-managed Cursor CLI profile helpers in the
//! crate root (`cursor_config_dir`, `cursor_cli_profile_dir`, ...), which
//! resolve ORGII-owned directories under `~/.orgii/`.
//!
//! ## Which home a resolver anchors to
//!
//! Two families, mirroring the crate root's `home_dir()` /
//! `external_history_home_dir()` split:
//!
//! - [`state_db_path`] and [`plugins_cache_dir`] anchor to the **real user's**
//!   home. They answer "where is the Cursor this person installed", which is
//!   what a settings surface reading Cursor's own configuration wants.
//! - [`external_history_state_db_path`] and
//!   [`external_history_conversation_index_db_path`] honor the
//!   `ORGII_EXTERNAL_HISTORY_HOME` override. When it is set they resolve
//!   deterministically beneath the override home and the real user's `$HOME` /
//!   `$XDG_CONFIG_HOME` / `%APPDATA%` is never consulted, so a secondary dev
//!   profile cannot discover — and then publish under a different cloud
//!   identity — the primary user's Cursor history.
//!
//! Pick by what the caller does with the path, not by convenience: the override
//! exists to stop *history ingestion* crossing identities, so a read that is
//! never published (plugin metadata, CLI config) belongs in the real-user
//! family alongside `agent_cli`'s `~/.cursor/cli-config.json` resolver.
//!
//! ## Unavailability
//!
//! When neither the override nor a usable home/config root exists, resolvers
//! return [`CursorPathsUnavailable`] instead of fabricating a path. Callers
//! decide how to degrade — for read-only discovery this is equivalent to
//! "Cursor is not installed".
//!
//! ## Scope
//!
//! This module is the only place the Cursor platform matrix is written down.
//! Consumers: `orgtrack_core` history ingestion (external-history family),
//! `agent_cli` plugin listing, `git-api`'s `cursor_chat`, `agent-core`'s
//! `cursor_native::auth`, the CLI usage tracker, and `key-vault`'s
//! `auto_detect::cursor` (via [`state_db_path_under`], which keeps that
//! crate's injected-home probes testable). Add a resolver here rather than
//! re-deriving the layout at a call site.

use std::path::{Path, PathBuf};

/// No home / platform-config root exists to anchor Cursor storage paths.
///
/// Practically: `ORGII_EXTERNAL_HISTORY_HOME` is unset or irrelevant,
/// `dirs::home_dir()` failed, and (on Linux/Windows) `$XDG_CONFIG_HOME` /
/// `%APPDATA%` are unset or unusable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorPathsUnavailable;

impl std::fmt::Display for CursorPathsUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(
            "no home or platform config directory is available to resolve Cursor storage paths",
        )
    }
}

impl std::error::Error for CursorPathsUnavailable {}

// ── Public API: the real user's Cursor installation ──

/// Cursor's global key-value store for the signed-in user:
/// `<globalStorage>/state.vscdb`.
///
/// Ignores `ORGII_EXTERNAL_HISTORY_HOME` — see the module docs. Does not check
/// existence; callers test that themselves.
pub fn state_db_path() -> Result<PathBuf, CursorPathsUnavailable> {
    let platform = current_platform();
    CursorEnv::real_user(platform).state_db_path(platform)
}

/// Cursor's marketplace plugin cache: `~/.cursor/plugins/cache/cursor-public/`.
///
/// Layout: one `{slug}/{hash}/` directory per downloaded plugin. Ignores
/// `ORGII_EXTERNAL_HISTORY_HOME` so it stays consistent with `agent_cli`'s
/// `~/.cursor/cli-config.json` resolver. Does not check existence.
pub fn plugins_cache_dir() -> Result<PathBuf, CursorPathsUnavailable> {
    CursorEnv::real_user(current_platform()).plugins_cache_dir()
}

/// `state.vscdb` under an explicitly supplied home, using the platform's
/// *default* layout.
///
/// For callers that inject a home rather than discovering one — key-vault's
/// suggestion probes take theirs from a `ProbeContext` so tests can point them
/// at a fixture tree. Deliberately ignores `$XDG_CONFIG_HOME` / `%APPDATA%`:
/// an injected home is a statement about where to look, and consulting the
/// process environment would let the real installation leak into it. Callers
/// that want the real installation should use [`state_db_path`] instead.
///
/// Does not check existence.
pub fn state_db_path_under(home: &Path) -> PathBuf {
    default_config_root_under(current_platform(), home)
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb")
}

// ── Public API: external-history discovery (identity-isolated) ──

/// `state.vscdb` for external-history ingestion, honoring
/// `ORGII_EXTERNAL_HISTORY_HOME`.
///
/// Does not check existence.
pub fn external_history_state_db_path() -> Result<PathBuf, CursorPathsUnavailable> {
    let platform = current_platform();
    CursorEnv::external_history(platform).state_db_path(platform)
}

/// Cursor's conversation index (newer builds), stored next to `state.vscdb`:
/// `<globalStorage>/conversation-search.db`. Honors
/// `ORGII_EXTERNAL_HISTORY_HOME`.
///
/// Does not check existence — older Cursor builds predate this file.
pub fn external_history_conversation_index_db_path() -> Result<PathBuf, CursorPathsUnavailable> {
    let platform = current_platform();
    CursorEnv::external_history(platform).conversation_index_db_path(platform)
}

// ── Pure resolver core ──

/// OS flavor, split from `cfg` blocks so the full platform matrix stays
/// unit-testable on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Platform {
    MacOs,
    /// Linux plus any other XDG-style unix.
    Linux,
    Windows,
}

fn current_platform() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(windows) {
        Platform::Windows
    } else {
        Platform::Linux
    }
}

/// Environment inputs that determine Cursor storage roots.
///
/// Production snapshots the process environment once per resolution
/// ([`CursorEnv::real_user`] / [`CursorEnv::external_history`]); tests
/// construct values directly to cover the whole platform matrix. Fields hold
/// already-validated values — env-string filtering lives in [`parse_env_path`].
#[derive(Debug, Clone, Default)]
struct CursorEnv {
    /// `ORGII_EXTERNAL_HISTORY_HOME` identity-isolation override. Always `None`
    /// for the real-user family, which must not be redirected by it.
    external_history_home: Option<PathBuf>,
    /// Real user home directory (`dirs::home_dir()`).
    home: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME` (absolute values only). Consulted on Linux.
    xdg_config_home: Option<PathBuf>,
    /// `%APPDATA%` (absolute values only). Consulted on Windows.
    appdata: Option<PathBuf>,
}

impl CursorEnv {
    /// Snapshot anchored to the signed-in user's home, never the isolation
    /// override.
    fn real_user(platform: Platform) -> Self {
        Self {
            external_history_home: None,
            home: dirs::home_dir(),
            xdg_config_home: env_path(platform, "XDG_CONFIG_HOME"),
            appdata: env_path(platform, "APPDATA"),
        }
    }

    /// Snapshot for external-history discovery: the isolation override when
    /// set, otherwise identical to [`CursorEnv::real_user`].
    fn external_history(platform: Platform) -> Self {
        Self {
            external_history_home: crate::external_history_home_override(),
            ..Self::real_user(platform)
        }
    }

    /// Root that Cursor's Electron shell resolves its `userData` dir against.
    fn config_root(&self, platform: Platform) -> Result<PathBuf, CursorPathsUnavailable> {
        // Isolation override: deterministic per-platform layout beneath the
        // override home; never read the real user's XDG/APPDATA environment
        // (same contract as `external_history_config_dir`).
        if let Some(isolated_home) = &self.external_history_home {
            return Ok(default_config_root_under(platform, isolated_home));
        }
        match platform {
            Platform::Linux => {
                if let Some(xdg_config_home) = &self.xdg_config_home {
                    return Ok(xdg_config_home.clone());
                }
            }
            Platform::Windows => {
                if let Some(appdata) = &self.appdata {
                    return Ok(appdata.clone());
                }
            }
            Platform::MacOs => {}
        }
        let home = self.home.as_deref().ok_or(CursorPathsUnavailable)?;
        Ok(default_config_root_under(platform, home))
    }

    /// Home root anchoring the `~/.cursor` dotdir family.
    fn home_root(&self) -> Result<PathBuf, CursorPathsUnavailable> {
        if let Some(isolated_home) = &self.external_history_home {
            return Ok(isolated_home.clone());
        }
        self.home.clone().ok_or(CursorPathsUnavailable)
    }

    fn global_storage_dir(&self, platform: Platform) -> Result<PathBuf, CursorPathsUnavailable> {
        Ok(self
            .config_root(platform)?
            .join("Cursor")
            .join("User")
            .join("globalStorage"))
    }

    fn state_db_path(&self, platform: Platform) -> Result<PathBuf, CursorPathsUnavailable> {
        Ok(self.global_storage_dir(platform)?.join("state.vscdb"))
    }

    fn conversation_index_db_path(
        &self,
        platform: Platform,
    ) -> Result<PathBuf, CursorPathsUnavailable> {
        Ok(self
            .global_storage_dir(platform)?
            .join("conversation-search.db"))
    }

    fn plugins_cache_dir(&self) -> Result<PathBuf, CursorPathsUnavailable> {
        Ok(self
            .home_root()?
            .join(".cursor")
            .join("plugins")
            .join("cache")
            .join("cursor-public"))
    }
}

/// Default per-platform config root beneath a given home directory — the
/// matrix previously duplicated across `orgtrack_core` and `agent_cli`.
fn default_config_root_under(platform: Platform, home: &Path) -> PathBuf {
    match platform {
        Platform::MacOs => home.join("Library").join("Application Support"),
        Platform::Linux => home.join(".config"),
        Platform::Windows => home.join("AppData").join("Roaming"),
    }
}

fn env_path(platform: Platform, var: &str) -> Option<PathBuf> {
    parse_env_path(platform, &std::env::var(var).ok()?)
}

/// Filter for env-provided directory values: trimmed, non-empty, absolute.
/// (The XDG base-dir spec requires relative `XDG_*` values to be ignored;
/// the same guard keeps a malformed `%APPDATA%` from producing a relative
/// storage root.)
fn parse_env_path(platform: Platform, value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    is_absolute_for(platform, trimmed).then(|| PathBuf::from(trimmed))
}

/// Whether an env-provided directory value is absolute *for `platform`*.
///
/// `Path::is_absolute` answers for the host, so it cannot judge a Windows
/// `%APPDATA%` on the unix hosts that run this suite — CI executes
/// `cargo test` on macOS only, and the Windows job is compile-only. Deciding
/// from `platform` keeps the rule under test on every host. The result matches
/// `std`'s definition: rooted on unix; drive-qualified or UNC/verbatim on
/// Windows, where a bare `/foo` and a drive-relative `C:foo` are both relative.
fn is_absolute_for(platform: Platform, value: &str) -> bool {
    match platform {
        Platform::MacOs | Platform::Linux => value.starts_with('/'),
        Platform::Windows => {
            if value.starts_with(r"\\") {
                return true;
            }
            let mut chars = value.chars();
            matches!(chars.next(), Some(drive) if drive.is_ascii_alphabetic())
                && chars.next() == Some(':')
                && matches!(chars.next(), Some('\\') | Some('/'))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_env::{env_lock, EnvVarGuard};

    // Fixture paths use `/` separators (host-native on the unix CI/dev hosts
    // this suite runs on) even for the Windows rows: `Path` equality compares
    // components, and the resolver core never inspects separators itself.

    const ALL_PLATFORMS: [Platform; 3] = [Platform::MacOs, Platform::Linux, Platform::Windows];

    fn env_with_home(home: &str) -> CursorEnv {
        CursorEnv {
            home: Some(PathBuf::from(home)),
            ..CursorEnv::default()
        }
    }

    // ── Platform matrix (no override) ──

    #[test]
    fn macos_global_storage_under_application_support() {
        let env = env_with_home("/Users/dev");
        assert_eq!(
            env.global_storage_dir(Platform::MacOs).unwrap(),
            PathBuf::from("/Users/dev/Library/Application Support/Cursor/User/globalStorage"),
        );
    }

    #[test]
    fn linux_global_storage_defaults_to_dot_config() {
        let env = env_with_home("/home/dev");
        assert_eq!(
            env.global_storage_dir(Platform::Linux).unwrap(),
            PathBuf::from("/home/dev/.config/Cursor/User/globalStorage"),
        );
    }

    #[test]
    fn linux_global_storage_respects_xdg_config_home() {
        let env = CursorEnv {
            home: Some(PathBuf::from("/home/dev")),
            xdg_config_home: Some(PathBuf::from("/mnt/config")),
            ..CursorEnv::default()
        };
        assert_eq!(
            env.global_storage_dir(Platform::Linux).unwrap(),
            PathBuf::from("/mnt/config/Cursor/User/globalStorage"),
        );
        // XDG is a Linux-only concept here: macOS keeps the home-based layout.
        assert_eq!(
            env.global_storage_dir(Platform::MacOs).unwrap(),
            PathBuf::from("/home/dev/Library/Application Support/Cursor/User/globalStorage"),
        );
    }

    #[test]
    fn windows_global_storage_prefers_appdata() {
        let env = CursorEnv {
            home: Some(PathBuf::from("C:/Users/dev")),
            appdata: Some(PathBuf::from("D:/Roaming")),
            ..CursorEnv::default()
        };
        assert_eq!(
            env.global_storage_dir(Platform::Windows).unwrap(),
            PathBuf::from("D:/Roaming/Cursor/User/globalStorage"),
        );
    }

    #[test]
    fn windows_global_storage_falls_back_to_home_appdata_roaming() {
        let env = env_with_home("C:/Users/dev");
        assert_eq!(
            env.global_storage_dir(Platform::Windows).unwrap(),
            PathBuf::from("C:/Users/dev/AppData/Roaming/Cursor/User/globalStorage"),
        );
    }

    // ── Identity-isolation override ──

    #[test]
    fn override_wins_and_real_environment_is_never_consulted() {
        let env = CursorEnv {
            external_history_home: Some(PathBuf::from("/tmp/orgii-instance2")),
            home: Some(PathBuf::from("/Users/real")),
            xdg_config_home: Some(PathBuf::from("/real/xdg")),
            appdata: Some(PathBuf::from("C:/real/appdata")),
        };
        assert_eq!(
            env.global_storage_dir(Platform::MacOs).unwrap(),
            PathBuf::from(
                "/tmp/orgii-instance2/Library/Application Support/Cursor/User/globalStorage"
            ),
        );
        assert_eq!(
            env.global_storage_dir(Platform::Linux).unwrap(),
            PathBuf::from("/tmp/orgii-instance2/.config/Cursor/User/globalStorage"),
        );
        assert_eq!(
            env.global_storage_dir(Platform::Windows).unwrap(),
            PathBuf::from("/tmp/orgii-instance2/AppData/Roaming/Cursor/User/globalStorage"),
        );
        assert_eq!(
            env.plugins_cache_dir().unwrap(),
            PathBuf::from("/tmp/orgii-instance2/.cursor/plugins/cache/cursor-public"),
        );
    }

    #[test]
    fn override_resolves_even_without_a_home_dir() {
        let env = CursorEnv {
            external_history_home: Some(PathBuf::from("/tmp/orgii-instance2")),
            ..CursorEnv::default()
        };
        for platform in ALL_PLATFORMS {
            assert!(env.global_storage_dir(platform).is_ok());
        }
        assert!(env.plugins_cache_dir().is_ok());
    }

    /// The real-user family must stay anchored to `$HOME` even while the
    /// isolation override is set, so `agent_cli`'s plugin cache keeps pointing
    /// at the same `~/.cursor` its `cli-config.json` resolver reads.
    #[test]
    fn real_user_snapshot_ignores_the_isolation_override() {
        let _lock = env_lock();
        let _isolation = EnvVarGuard::set("ORGII_EXTERNAL_HISTORY_HOME", "/tmp/orgii-instance2");

        let real_user = CursorEnv::real_user(Platform::MacOs);
        assert_eq!(real_user.external_history_home, None);

        let isolated = CursorEnv::external_history(Platform::MacOs);
        assert_eq!(
            isolated.external_history_home,
            Some(PathBuf::from("/tmp/orgii-instance2")),
        );
        // Same real home underneath — only the override field differs.
        assert_eq!(real_user.home, isolated.home);
    }

    /// The invariant the split exists to protect: with the override set, the
    /// plugin cache still lands under the real `$HOME` that
    /// `agent_cli::cursor::commands` reads `~/.cursor/cli-config.json` from,
    /// while history ingestion follows the override.
    #[test]
    fn public_api_splits_the_two_homes_under_isolation() {
        let _lock = env_lock();
        let isolated_home = "/tmp/orgii-instance2";
        let _isolation = EnvVarGuard::set("ORGII_EXTERNAL_HISTORY_HOME", isolated_home);

        let Some(real_home) = dirs::home_dir() else {
            // No home on this host: every resolver reports unavailable and
            // there is nothing to compare.
            assert_eq!(plugins_cache_dir(), Err(CursorPathsUnavailable));
            return;
        };

        let cache = plugins_cache_dir().expect("real home resolves");
        assert!(
            cache.starts_with(&real_home),
            "plugin cache {} escaped the real home",
            cache.display(),
        );
        assert!(!cache.starts_with(isolated_home));

        assert!(state_db_path()
            .expect("real home resolves")
            .starts_with(&real_home));

        for isolated in [
            external_history_state_db_path().unwrap(),
            external_history_conversation_index_db_path().unwrap(),
        ] {
            assert!(
                isolated.starts_with(isolated_home),
                "history path {} ignored the isolation override",
                isolated.display(),
            );
        }
    }

    #[test]
    fn external_history_snapshot_matches_real_user_without_the_override() {
        let _lock = env_lock();
        let _isolation = EnvVarGuard::unset("ORGII_EXTERNAL_HISTORY_HOME");

        assert_eq!(
            CursorEnv::external_history(Platform::Linux).external_history_home,
            None,
        );
    }

    // ── Typed unavailability ──

    #[test]
    fn missing_home_is_typed_unavailable_not_a_fake_path() {
        let env = CursorEnv::default();
        for platform in ALL_PLATFORMS {
            assert_eq!(
                env.global_storage_dir(platform),
                Err(CursorPathsUnavailable)
            );
            assert_eq!(env.state_db_path(platform), Err(CursorPathsUnavailable));
        }
        assert_eq!(env.plugins_cache_dir(), Err(CursorPathsUnavailable));
    }

    #[test]
    fn windows_appdata_alone_resolves_global_storage_but_not_home_dotdir() {
        let env = CursorEnv {
            appdata: Some(PathBuf::from("C:/Roaming")),
            ..CursorEnv::default()
        };
        assert_eq!(
            env.global_storage_dir(Platform::Windows).unwrap(),
            PathBuf::from("C:/Roaming/Cursor/User/globalStorage"),
        );
        assert_eq!(env.plugins_cache_dir(), Err(CursorPathsUnavailable));
    }

    // ── File names & dotdir family ──

    #[test]
    fn database_file_names_join_global_storage() {
        let env = env_with_home("/Users/dev");
        assert_eq!(
            env.state_db_path(Platform::MacOs).unwrap(),
            PathBuf::from(
                "/Users/dev/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
            ),
        );
        assert_eq!(
            env.conversation_index_db_path(Platform::MacOs).unwrap(),
            PathBuf::from(
                "/Users/dev/Library/Application Support/Cursor/User/globalStorage/conversation-search.db"
            ),
        );
    }

    #[test]
    fn state_db_path_under_uses_the_platform_default_layout() {
        // Mirrors `default_config_root_under`, which the platform-matrix tests
        // above already pin; this guards the joined file name and the promise
        // that an injected home is used verbatim.
        let injected = Path::new("/fixtures/fake-home");
        let resolved = state_db_path_under(injected);
        assert!(resolved.starts_with(injected));
        assert!(resolved.ends_with("Cursor/User/globalStorage/state.vscdb"));
    }

    /// An injected home must win even while the real environment points
    /// elsewhere — otherwise a fixture probe could read the developer's own
    /// Cursor install.
    #[test]
    fn state_db_path_under_ignores_the_process_environment() {
        let _lock = env_lock();
        let _xdg = EnvVarGuard::set("XDG_CONFIG_HOME", "/real/xdg");
        let _appdata = EnvVarGuard::set("APPDATA", "C:/real/appdata");
        let _isolation = EnvVarGuard::set("ORGII_EXTERNAL_HISTORY_HOME", "/tmp/orgii-instance2");

        let resolved = state_db_path_under(Path::new("/fixtures/fake-home"));
        assert!(resolved.starts_with("/fixtures/fake-home"));
        for foreign in ["/real/xdg", "/tmp/orgii-instance2"] {
            assert!(
                !resolved.starts_with(foreign),
                "{} leaked into an injected-home resolution",
                foreign,
            );
        }
    }

    #[test]
    fn plugins_cache_is_home_anchored() {
        let env = env_with_home("/home/dev");
        assert_eq!(
            env.plugins_cache_dir().unwrap(),
            PathBuf::from("/home/dev/.cursor/plugins/cache/cursor-public"),
        );
    }

    // ── Env-value filtering ──

    #[test]
    fn parse_env_path_filters_blank_values_on_every_platform() {
        for platform in ALL_PLATFORMS {
            assert_eq!(parse_env_path(platform, ""), None);
            assert_eq!(parse_env_path(platform, "   "), None);
        }
    }

    #[test]
    fn parse_env_path_keeps_absolute_unix_values_and_trims_them() {
        for platform in [Platform::MacOs, Platform::Linux] {
            assert_eq!(parse_env_path(platform, "relative/config"), None);
            assert_eq!(
                parse_env_path(platform, "  /abs/config  "),
                Some(PathBuf::from("/abs/config")),
            );
        }
    }

    /// Runs on unix hosts too: absoluteness is decided from `Platform`, not
    /// from the host's `Path::is_absolute`.
    #[test]
    fn parse_env_path_applies_windows_absoluteness_rules() {
        let windows_absolute = [
            r"C:\Users\dev\AppData\Roaming",
            "C:/Users/dev/AppData/Roaming",
            r"\\server\share\Roaming",
            r"\\?\D:\Roaming",
        ];
        for value in windows_absolute {
            assert_eq!(
                parse_env_path(Platform::Windows, value),
                Some(PathBuf::from(value)),
                "expected {value} to be absolute on Windows",
            );
        }

        let windows_relative = [
            "relative/config",
            r"C:relative\config", // drive-relative, not rooted
            "/unix/style/root",   // rooted but has no drive prefix
            "1:/not/a/drive",
        ];
        for value in windows_relative {
            assert_eq!(
                parse_env_path(Platform::Windows, value),
                None,
                "expected {value} to be rejected on Windows",
            );
        }
    }

    /// Guards the hand-rolled Windows rule against `std`, on the one host where
    /// `Path::is_absolute` actually speaks Windows.
    #[cfg(windows)]
    #[test]
    fn windows_absoluteness_matches_std_on_windows_hosts() {
        for value in [
            r"C:\Users\dev",
            "C:/Users/dev",
            r"\\server\share",
            r"\\?\D:\Roaming",
            r"C:relative",
            "/unix/style/root",
            "relative/config",
        ] {
            assert_eq!(
                is_absolute_for(Platform::Windows, value),
                Path::new(value).is_absolute(),
                "disagreed with std::path on {value}",
            );
        }
    }
}
