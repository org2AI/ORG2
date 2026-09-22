//! App-lock state machine tests, driven against a temp lock file with an
//! injected clock. They pin the properties the lock screen depends on:
//!
//! - the password is only ever stored as a salted digest;
//! - lock state survives a process restart (quit-and-relaunch is not a bypass)
//!   and lock-on-launch applies at load;
//! - a locked app refuses every mutation except unlock;
//! - wrong guesses are throttled across unlock / change / clear alike;
//! - the idle auto-lock measures wall time since the last reported activity.

use std::sync::LazyLock;
use std::time::{Duration, SystemTime};

use crate::app_lock::{
    AppLockCore, ERR_HINT_REVEALS_PASSWORD, ERR_HINT_TOO_LONG, ERR_INVALID_AUTO_LOCK,
    ERR_INVALID_PASSWORD, ERR_LOCKED, ERR_NOT_ENABLED, ERR_PASSWORD_TOO_LONG,
    ERR_PASSWORD_TOO_SHORT, ERR_THROTTLED, MAX_HINT_CHARS, MAX_PASSWORD_CHARS, MIN_PASSWORD_CHARS,
};

/// Test passwords are generated at run time, not written down. No test needs
/// a particular value, and a literal flowing into the KDF is exactly what
/// static analysis flags as a hard-coded credential — keeping literals out of
/// here keeps that signal meaningful for the production code. Lowercase
/// letters only, so the case-insensitive hint check has something to fold.
fn generated_password() -> String {
    let bytes: [u8; 12] = rand::random();
    bytes
        .iter()
        .map(|byte| char::from(b'a' + byte % 26))
        .collect()
}

static PASSWORDS: LazyLock<[String; 3]> = LazyLock::new(|| {
    [
        generated_password(),
        generated_password(),
        generated_password(),
    ]
});

/// The password the fixtures set.
fn password() -> &'static str {
    &PASSWORDS[0]
}

/// A second valid password, for change-password flows.
fn other_password() -> &'static str {
    &PASSWORDS[1]
}

/// A well-formed password that is never the right one.
fn wrong_password() -> &'static str {
    &PASSWORDS[2]
}

/// Enough rounds to exercise the real KDF, few enough that a debug build runs
/// the suite in well under a second. The production count is pinned by
/// `new_digests_use_the_production_round_count`.
const TEST_KDF_ITERATIONS: u32 = 1_000;

fn t0() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000)
}

fn minutes(count: u64) -> Duration {
    Duration::from_secs(count * 60)
}

struct Fixture {
    dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("temp dir"),
        }
    }

    fn path(&self) -> std::path::PathBuf {
        self.dir.path().join("app-lock.json")
    }

    /// A fresh core over the same file — i.e. a process restart.
    fn load(&self, now: SystemTime) -> AppLockCore {
        AppLockCore::load(self.path(), now).with_kdf_iterations(TEST_KDF_ITERATIONS)
    }

    fn with_password(&self) -> AppLockCore {
        let mut core = self.load(t0());
        core.set_password(None, password(), None, t0())
            .expect("set");
        core
    }
}

#[test]
fn starts_disabled_and_cannot_lock_without_a_password() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    let status = core.status(t0());
    assert!(!status.enabled);
    assert!(!status.locked);
    assert_eq!(core.lock(), Err(ERR_NOT_ENABLED.to_string()));
    assert_eq!(core.unlock(wrong_password(), t0()), Ok(true));
}

#[test]
fn password_is_stored_only_as_a_salted_digest() {
    let fixture = Fixture::new();
    let _core = fixture.with_password();
    let on_disk = std::fs::read_to_string(fixture.path()).expect("lock file");
    assert!(!on_disk.contains(password()));
    assert!(on_disk.contains("pbkdf2-hmac-sha256"));

    // Same password, fresh salt → different digest.
    let other = Fixture::new();
    let _other_core = other.with_password();
    let other_on_disk = std::fs::read_to_string(other.path()).expect("lock file");
    assert_ne!(on_disk, other_on_disk);
}

#[test]
fn new_digests_use_the_production_round_count() {
    let fixture = Fixture::new();
    let mut core = AppLockCore::load(fixture.path(), t0());
    core.set_password(None, password(), None, t0())
        .expect("set");
    let on_disk = std::fs::read_to_string(fixture.path()).expect("lock file");
    assert!(on_disk.contains("\"iterations\": 600000"), "{on_disk}");

    // A digest written with one round count still verifies under a core
    // configured with another: the count travels with the digest.
    let mut reloaded = fixture.load(t0());
    reloaded.lock().expect("lock");
    assert_eq!(reloaded.unlock(password(), t0()), Ok(true));
}

#[cfg(unix)]
#[test]
fn lock_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let _core = fixture.with_password();
    let mode = std::fs::metadata(fixture.path())
        .expect("metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn rejects_passwords_outside_the_length_bounds() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    assert_eq!(
        core.set_password(None, &"a".repeat(MIN_PASSWORD_CHARS - 1), None, t0()),
        Err(ERR_PASSWORD_TOO_SHORT.to_string())
    );
    let too_long = "x".repeat(MAX_PASSWORD_CHARS + 1);
    assert_eq!(
        core.set_password(None, &too_long, None, t0()),
        Err(ERR_PASSWORD_TOO_LONG.to_string())
    );
    assert!(!core.status(t0()).enabled);
    // Length is counted in characters, not bytes: this is three times the
    // limit in UTF-8 and exactly the limit in characters.
    assert_eq!(
        core.set_password(None, &"密".repeat(MAX_PASSWORD_CHARS), None, t0()),
        Ok(())
    );
}

#[test]
fn lock_then_unlock_round_trip() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    assert_eq!(core.lock(), Ok(true));
    assert_eq!(core.lock(), Ok(false), "locking twice is a no-op");
    assert!(core.status(t0()).locked);

    assert_eq!(core.unlock(wrong_password(), t0()), Ok(false));
    assert!(core.status(t0()).locked);

    assert_eq!(core.unlock(password(), t0()), Ok(true));
    assert!(!core.status(t0()).locked);
}

#[test]
fn locked_state_survives_a_restart() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.lock().expect("lock");
    drop(core);

    let mut restarted = fixture.load(t0());
    assert!(restarted.status(t0()).locked);
    assert_eq!(restarted.unlock(password(), t0()), Ok(true));
    drop(restarted);

    assert!(!fixture.load(t0()).status(t0()).locked);
}

#[test]
fn lock_on_launch_locks_at_load_only() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.update_preferences(true, 0, t0()).expect("prefs");
    assert!(
        !core.status(t0()).locked,
        "turning the preference on must not lock the running app"
    );
    drop(core);

    let restarted = fixture.load(t0());
    let status = restarted.status(t0());
    assert!(status.locked);
    assert!(status.lock_on_launch);
}

#[test]
fn a_locked_app_refuses_every_mutation_but_unlock() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.lock().expect("lock");

    assert_eq!(
        core.set_password(Some(password()), other_password(), None, t0()),
        Err(ERR_LOCKED.to_string())
    );
    assert_eq!(
        core.clear_password(password(), t0()),
        Err(ERR_LOCKED.to_string())
    );
    assert_eq!(
        core.update_preferences(false, 5, t0()),
        Err(ERR_LOCKED.to_string())
    );
    assert!(core.status(t0()).locked);
}

#[test]
fn changing_or_clearing_needs_the_current_password() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();

    assert_eq!(
        core.set_password(None, other_password(), None, t0()),
        Err(ERR_INVALID_PASSWORD.to_string())
    );
    assert_eq!(
        core.set_password(Some(wrong_password()), other_password(), None, t0()),
        Err(ERR_INVALID_PASSWORD.to_string())
    );
    assert_eq!(
        core.clear_password(wrong_password(), t0()),
        Err(ERR_INVALID_PASSWORD.to_string())
    );

    assert_eq!(
        core.set_password(Some(password()), other_password(), None, t0()),
        Ok(())
    );
    core.lock().expect("lock");
    assert_eq!(
        core.unlock(password(), t0()),
        Ok(false),
        "old password is dead"
    );
    assert_eq!(core.unlock(other_password(), t0()), Ok(true));

    assert_eq!(core.clear_password(other_password(), t0()), Ok(()));
    let status = core.status(t0());
    assert!(!status.enabled);
    assert!(!status.locked);
    assert!(!fixture.load(t0()).status(t0()).enabled);
}

#[test]
fn wrong_guesses_are_throttled_then_released() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.lock().expect("lock");

    for _ in 0..4 {
        assert_eq!(core.unlock(wrong_password(), t0()), Ok(false));
        assert_eq!(core.status(t0()).retry_after_ms, 0);
    }
    // Fifth miss starts the first 30 s delay.
    assert_eq!(core.unlock(wrong_password(), t0()), Ok(false));
    assert_eq!(core.status(t0()).retry_after_ms, 30_000);

    // While throttled even the right password is refused — otherwise the
    // delay would not slow a guesser down at all.
    assert_eq!(
        core.unlock(password(), t0() + Duration::from_secs(29)),
        Err(ERR_THROTTLED.to_string())
    );
    assert!(core.status(t0()).locked);

    // The delay doubles on the next miss…
    let after_first_delay = t0() + Duration::from_secs(30);
    assert_eq!(core.unlock(wrong_password(), after_first_delay), Ok(false));
    assert_eq!(core.status(after_first_delay).retry_after_ms, 60_000);

    // …and a correct password after it clears the counter.
    let after_second_delay = after_first_delay + Duration::from_secs(60);
    assert_eq!(core.unlock(password(), after_second_delay), Ok(true));
    assert_eq!(core.status(after_second_delay).retry_after_ms, 0);
}

#[test]
fn throttle_delay_is_capped() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.lock().expect("lock");
    let mut now = t0();
    for _ in 0..40 {
        let wait = Duration::from_millis(core.status(now).retry_after_ms);
        now += wait;
        assert_eq!(core.unlock(wrong_password(), now), Ok(false));
    }
    assert_eq!(core.status(now).retry_after_ms, 15 * 60 * 1_000);
}

#[test]
fn change_and_clear_share_the_unlock_throttle() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    for _ in 0..5 {
        assert_eq!(
            core.clear_password(wrong_password(), t0()),
            Err(ERR_INVALID_PASSWORD.to_string())
        );
    }
    assert_eq!(
        core.set_password(Some(password()), other_password(), None, t0()),
        Err(ERR_THROTTLED.to_string())
    );
}

#[test]
fn auto_lock_fires_after_the_idle_delay_and_activity_resets_it() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.update_preferences(false, 5, t0()).expect("prefs");

    assert!(!core.auto_lock_due(t0() + minutes(4)));
    assert!(core.auto_lock_due(t0() + minutes(5)));

    core.report_activity(t0() + minutes(4));
    assert!(!core.auto_lock_due(t0() + minutes(8)));
    assert!(core.auto_lock_due(t0() + minutes(9)));

    core.lock().expect("lock");
    assert!(
        !core.auto_lock_due(t0() + minutes(60)),
        "already locked — nothing to do"
    );
}

#[test]
fn auto_lock_never_fires_when_disabled_or_set_to_never() {
    let fixture = Fixture::new();
    let mut without_password = fixture.load(t0());
    assert!(!without_password.auto_lock_due(t0() + minutes(600)));
    assert_eq!(
        without_password.update_preferences(false, 7, t0()),
        Err(ERR_INVALID_AUTO_LOCK.to_string())
    );

    let other = Fixture::new();
    let core = other.with_password();
    assert!(!core.auto_lock_due(t0() + minutes(600)), "0 means never");
}

#[test]
fn unlocking_restarts_the_idle_clock() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    core.update_preferences(false, 1, t0()).expect("prefs");
    core.lock().expect("lock");

    let back = t0() + minutes(90);
    assert_eq!(core.unlock(password(), back), Ok(true));
    assert!(
        !core.auto_lock_due(back),
        "must not re-lock the instant the user gets back in"
    );
    assert!(core.auto_lock_due(back + minutes(1)));
}

#[test]
fn a_corrupt_lock_file_reads_as_disabled_not_as_a_crash() {
    let fixture = Fixture::new();
    std::fs::write(fixture.path(), b"{ not json").expect("write");
    let core = fixture.load(t0());
    let status = core.status(t0());
    assert!(!status.enabled);
    assert!(!status.locked);
}

#[test]
fn a_locked_flag_without_a_password_cannot_strand_the_user() {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.path(),
        br#"{"version":1,"password":null,"locked":true,"lockOnLaunch":true,"autoLockMinutes":5}"#,
    )
    .expect("write");
    let core = fixture.load(t0());
    assert!(!core.status(t0()).locked);
}

#[test]
fn hint_is_stored_trimmed_and_shown_while_locked() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    core.set_password(None, password(), Some("  the usual one  "), t0())
        .expect("set");
    assert_eq!(core.status(t0()).hint.as_deref(), Some("the usual one"));

    core.lock().expect("lock");
    assert_eq!(
        core.status(t0()).hint.as_deref(),
        Some("the usual one"),
        "the lock page is where the hint is needed"
    );
    assert_eq!(
        fixture.load(t0()).status(t0()).hint.as_deref(),
        Some("the usual one")
    );
}

#[test]
fn a_blank_hint_means_no_hint() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    core.set_password(None, password(), Some("   "), t0())
        .expect("set");
    assert_eq!(core.status(t0()).hint, None);
}

#[test]
fn hint_may_not_give_the_password_away() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    // Different case on purpose: the containment check folds case.
    let revealing = format!("it is {}, obviously", password().to_uppercase());
    assert_eq!(
        core.set_password(None, password(), Some(revealing.as_str()), t0()),
        Err(ERR_HINT_REVEALS_PASSWORD.to_string())
    );
    assert!(!core.status(t0()).enabled, "a rejected hint sets nothing");

    core.set_password(None, password(), None, t0())
        .expect("set");
    assert_eq!(
        core.set_hint(Some(password())),
        Err(ERR_HINT_REVEALS_PASSWORD.to_string())
    );
    assert_eq!(core.status(t0()).hint, None);
}

#[test]
fn hint_length_is_bounded_in_characters() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    let too_long = "提".repeat(MAX_HINT_CHARS + 1);
    assert_eq!(
        core.set_hint(Some(&too_long)),
        Err(ERR_HINT_TOO_LONG.to_string())
    );
    assert_eq!(core.set_hint(Some(&"提".repeat(MAX_HINT_CHARS))), Ok(()));
}

#[test]
fn hint_can_be_changed_and_removed_without_the_password() {
    let fixture = Fixture::new();
    let mut core = fixture.with_password();
    assert_eq!(core.set_hint(Some("first")), Ok(()));
    assert_eq!(core.set_hint(Some("second")), Ok(()));
    assert_eq!(core.status(t0()).hint.as_deref(), Some("second"));
    assert_eq!(core.set_hint(None), Ok(()));
    assert_eq!(core.status(t0()).hint, None);
}

#[test]
fn hint_cannot_be_edited_while_locked_or_without_a_password() {
    let fixture = Fixture::new();
    let mut without_password = fixture.load(t0());
    assert_eq!(
        without_password.set_hint(Some("anything")),
        Err(ERR_NOT_ENABLED.to_string())
    );

    let other = Fixture::new();
    let mut core = other.with_password();
    core.lock().expect("lock");
    assert_eq!(core.set_hint(Some("anything")), Err(ERR_LOCKED.to_string()));
}

#[test]
fn changing_the_password_replaces_the_hint_and_removing_it_clears_the_hint() {
    let fixture = Fixture::new();
    let mut core = fixture.load(t0());
    core.set_password(None, password(), Some("old hint"), t0())
        .expect("set");

    // No hint supplied with the new password: the old one described the old
    // password and must not linger.
    core.set_password(Some(password()), other_password(), None, t0())
        .expect("change");
    assert_eq!(core.status(t0()).hint, None);

    core.set_hint(Some("new hint")).expect("hint");
    core.clear_password(other_password(), t0()).expect("clear");
    assert_eq!(core.status(t0()).hint, None);
    assert!(!std::fs::read_to_string(fixture.path())
        .expect("lock file")
        .contains("new hint"));
}
