//! Firefox `profiles.ini` parsing tests.

use super::parse_firefox_profiles_ini;

#[test]
fn parses_relative_and_absolute_profiles() {
    let ini = "\
[Install2656FF1E]
Default=Profiles/abc.default-release
Locked=1

[Profile1]
Name=default
IsRelative=1
Path=Profiles/knehl59t.default
Default=1

[Profile0]
Name=default-release
IsRelative=0
Path=/custom/abs/path

[General]
StartWithLastProfile=1
Version=2
";
    let profiles = parse_firefox_profiles_ini(ini);
    assert_eq!(
        profiles,
        vec![
            ("Profiles/knehl59t.default".to_string(), true),
            ("/custom/abs/path".to_string(), false),
        ]
    );
}

#[test]
fn ignores_non_profile_sections_and_defaults_relative() {
    let ini = "\
[Profile0]
Path=Profiles/only.default
";
    // No IsRelative line means relative by default.
    assert_eq!(
        parse_firefox_profiles_ini(ini),
        vec![("Profiles/only.default".to_string(), true)]
    );
    // A body with no profile sections yields nothing.
    assert!(parse_firefox_profiles_ini("[General]\nVersion=2\n").is_empty());
}

// ============================================================================
// Blocked is not absent
//
// macOS refuses reads of another app's data without Full Disk Access while
// still showing that the files exist. File modes reproduce that shape: a
// directory without the read bit cannot be listed, but its children can still
// be stat-ed. A scanner must turn that into a blocked source, never into
// silence.
// ============================================================================

#[cfg(unix)]
mod blocked {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use super::super::discover_firefox_in;
    use crate::cookie_import::SourceUnavailableReason;

    fn set_mode(path: &Path, mode: u32) {
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("chmod");
    }

    /// File modes do not bind root, so a denial cannot be staged there.
    fn denial_takes_effect(probe: &Path) -> bool {
        fs::read(probe).is_err() && fs::read_dir(probe).is_err()
    }

    #[test]
    fn firefox_with_an_unreadable_profiles_ini_is_reported_as_blocked() {
        let root = tempfile::tempdir().expect("temp dir");
        let ini = root.path().join("profiles.ini");
        fs::write(&ini, "[Profile0]\nPath=Profiles/a.default\n").expect("write ini");
        set_mode(&ini, 0o000);
        if !denial_takes_effect(&ini) {
            return;
        }

        let mut sources = Vec::new();
        discover_firefox_in(root.path(), &mut sources);
        set_mode(&ini, 0o600);

        assert_eq!(sources.len(), 1, "a blocked Firefox must not vanish");
        assert_eq!(sources[0].browser_id, "firefox");
        assert_eq!(
            sources[0].unavailable_reason,
            Some(SourceUnavailableReason::NeedsFullDiskAccess)
        );
    }

    #[test]
    fn firefox_that_is_not_installed_is_not_reported() {
        let root = tempfile::tempdir().expect("temp dir");
        let mut sources = Vec::new();
        discover_firefox_in(root.path(), &mut sources);
        assert!(sources.is_empty());
    }

    #[cfg(target_os = "macos")]
    mod chromium {
        use super::*;
        use crate::cookie_import::sources::discover_chromium_in;

        /// A Chrome install with one profile that holds a cookie store.
        fn chrome_install(app_support: &Path) -> std::path::PathBuf {
            let user_data = app_support.join("Google/Chrome");
            fs::create_dir_all(user_data.join("Default/Network")).expect("profile dir");
            fs::write(user_data.join("Default/Network/Cookies"), b"").expect("store");
            fs::write(user_data.join("Local State"), b"{}").expect("local state");
            user_data
        }

        #[test]
        fn a_readable_install_lists_its_profiles() {
            let app_support = tempfile::tempdir().expect("temp dir");
            chrome_install(app_support.path());

            let mut sources = Vec::new();
            discover_chromium_in(app_support.path(), &mut sources);

            assert_eq!(sources.len(), 1);
            assert_eq!(sources[0].id, "chromium:chrome:Default");
            assert_eq!(sources[0].unavailable_reason, None);
        }

        #[test]
        fn an_install_the_os_will_not_let_us_read_is_reported_as_blocked() {
            let app_support = tempfile::tempdir().expect("temp dir");
            let user_data = chrome_install(app_support.path());
            // Traversable but not listable: `Local State` stays visible to stat.
            set_mode(&user_data, 0o300);
            if !denial_takes_effect(&user_data) {
                set_mode(&user_data, 0o700);
                return;
            }

            let mut sources = Vec::new();
            discover_chromium_in(app_support.path(), &mut sources);
            set_mode(&user_data, 0o700);

            assert_eq!(sources.len(), 1, "a blocked Chrome must not vanish");
            assert_eq!(sources[0].browser_id, "chrome");
            assert_eq!(sources[0].profile_label, None);
            assert_eq!(
                sources[0].unavailable_reason,
                Some(SourceUnavailableReason::NeedsFullDiskAccess)
            );
        }

        #[test]
        fn a_leftover_empty_vendor_folder_is_not_a_blocked_browser() {
            let app_support = tempfile::tempdir().expect("temp dir");
            // No `Local State`: a shell left behind, not an install.
            let leftover = app_support.path().join("Microsoft Edge");
            fs::create_dir_all(&leftover).expect("vendor dir");
            set_mode(&leftover, 0o300);

            let mut sources = Vec::new();
            discover_chromium_in(app_support.path(), &mut sources);
            set_mode(&leftover, 0o700);

            assert!(sources.is_empty(), "got {sources:?}");
        }
    }
}
