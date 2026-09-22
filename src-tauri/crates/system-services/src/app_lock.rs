//! App lock — a password-gated lock screen for the desktop windows, so an
//! agent can keep working while nobody at the keyboard can read or steer it.
//!
//! The lock is owned here rather than in the webview for one reason: the
//! webview is not a trust boundary. A frontend-only flag is lost on reload and
//! never reaches a second window, so both would open the app unlocked. Here the
//! state is process-wide, every window projects it, and the password never
//! leaves this module except as a PBKDF2 digest.
//!
//! Scope: this is a screen lock, not encryption. Sessions keep running and the
//! data under `~/.orgii/` stays readable to anyone with filesystem access, who
//! could equally delete `app-lock.json` to remove the password. It protects an
//! unattended, unlocked desktop session from a passer-by — nothing stronger.
//!
//! Commands:
//! - `app_lock_status` — current projection, safe to call while locked
//! - `app_lock_set_password` / `app_lock_clear_password` — need the current
//!   password once one exists
//! - `app_lock_set_hint` — optional password hint shown on the lock page
//! - `app_lock_update_preferences` — auto-lock delay and lock-on-launch
//! - `app_lock_lock` / `app_lock_unlock`
//! - `app_lock_report_activity` — windows report user input so the idle
//!   auto-lock measures the whole app, not one window
//!
//! Every state change is broadcast as [`APP_LOCK_CHANGED_EVENT`].

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tauri::Emitter;

pub const APP_LOCK_CHANGED_EVENT: &str = "app-lock:changed";

const LOCK_FILE_NAME: &str = "app-lock.json";
const RECORD_VERSION: u32 = 1;
const KDF_ALGORITHM: &str = "pbkdf2-hmac-sha256";
/// OWASP's 2023 floor for PBKDF2-HMAC-SHA256.
const KDF_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const HASH_LEN: usize = 32;

pub const MIN_PASSWORD_CHARS: usize = 4;
pub const MAX_PASSWORD_CHARS: usize = 256;
pub const MAX_HINT_CHARS: usize = 120;

/// Wrong guesses allowed before the first delay.
const FREE_ATTEMPTS: u32 = 5;
const BASE_RETRY_DELAY: Duration = Duration::from_secs(30);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(15 * 60);

/// Auto-lock delays the UI offers; `0` means never. Anything else is rejected
/// so a hand-edited file cannot install a delay the settings page can't show.
pub const AUTO_LOCK_MINUTE_CHOICES: [u32; 6] = [0, 1, 5, 15, 30, 60];

/// How often the idle watcher re-reads the wall clock. Wall time (not a
/// monotonic timer) so minutes spent in system sleep count as idle.
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(15);

pub const ERR_NOT_ENABLED: &str = "app_lock:not_enabled";
pub const ERR_LOCKED: &str = "app_lock:locked";
pub const ERR_INVALID_PASSWORD: &str = "app_lock:invalid_password";
pub const ERR_THROTTLED: &str = "app_lock:throttled";
pub const ERR_PASSWORD_TOO_SHORT: &str = "app_lock:password_too_short";
pub const ERR_PASSWORD_TOO_LONG: &str = "app_lock:password_too_long";
pub const ERR_INVALID_AUTO_LOCK: &str = "app_lock:invalid_auto_lock";
pub const ERR_HINT_TOO_LONG: &str = "app_lock:hint_too_long";
pub const ERR_HINT_REVEALS_PASSWORD: &str = "app_lock:hint_reveals_password";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PasswordDigest {
    algorithm: String,
    iterations: u32,
    salt: String,
    hash: String,
}

/// On-disk record: `~/.orgii/app-lock.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LockRecord {
    version: u32,
    #[serde(default)]
    password: Option<PasswordDigest>,
    /// Shown to anyone looking at the lock page, so it is stored in the clear
    /// and must never give the password away (see [`normalize_hint`]).
    #[serde(default)]
    hint: Option<String>,
    /// Persisted so quitting a locked app cannot be used to get past it.
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    lock_on_launch: bool,
    #[serde(default)]
    auto_lock_minutes: u32,
}

impl Default for LockRecord {
    fn default() -> Self {
        Self {
            version: RECORD_VERSION,
            password: None,
            hint: None,
            locked: false,
            lock_on_launch: false,
            auto_lock_minutes: 0,
        }
    }
}

/// Projection sent to every window. Never carries digest material.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppLockStatus {
    pub enabled: bool,
    pub locked: bool,
    pub lock_on_launch: bool,
    pub auto_lock_minutes: u32,
    /// Password hint, if one is set. Deliberately part of the locked
    /// projection: the lock page is where it is needed.
    pub hint: Option<String>,
    /// Milliseconds until another password attempt is accepted; `0` when none
    /// is pending.
    pub retry_after_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppLockUnlockOutcome {
    pub unlocked: bool,
    pub status: AppLockStatus,
}

/// The lock state machine, independent of Tauri and of the real data root so
/// tests drive it against a temp file with an injected clock.
#[derive(Debug)]
pub struct AppLockCore {
    path: PathBuf,
    record: LockRecord,
    failed_attempts: u32,
    retry_not_before: Option<SystemTime>,
    last_activity: SystemTime,
    /// Rounds used for *new* digests; verification always uses the count
    /// stored with the digest.
    kdf_iterations: u32,
}

impl AppLockCore {
    /// Load the record at process start. `lock_on_launch` is applied here —
    /// the only moment that is a launch rather than a webview reload.
    pub fn load(path: PathBuf, now: SystemTime) -> Self {
        let mut record = read_record(&path);
        if record.password.is_none() {
            record.locked = false;
            record.hint = None;
        } else if record.lock_on_launch {
            record.locked = true;
        }
        Self {
            path,
            record,
            failed_attempts: 0,
            retry_not_before: None,
            last_activity: now,
            kdf_iterations: KDF_ITERATIONS,
        }
    }

    /// Test seam: the production round count makes a suite that derives a
    /// digest per assertion take minutes in an unoptimized build.
    #[doc(hidden)]
    pub fn with_kdf_iterations(mut self, iterations: u32) -> Self {
        self.kdf_iterations = iterations;
        self
    }

    pub fn status(&self, now: SystemTime) -> AppLockStatus {
        AppLockStatus {
            enabled: self.record.password.is_some(),
            locked: self.record.locked,
            lock_on_launch: self.record.lock_on_launch,
            auto_lock_minutes: self.record.auto_lock_minutes,
            hint: self.record.password.as_ref().and(self.record.hint.clone()),
            retry_after_ms: self.retry_after(now).as_millis() as u64,
        }
    }

    fn retry_after(&self, now: SystemTime) -> Duration {
        self.retry_not_before
            .and_then(|deadline| deadline.duration_since(now).ok())
            .unwrap_or_default()
    }

    /// Check `candidate` against the stored digest, with throttling. Shared by
    /// unlock, change and clear so none of them is an unthrottled oracle.
    fn verify(&mut self, candidate: &str, now: SystemTime) -> Result<(), String> {
        let Some(digest) = self.record.password.clone() else {
            return Err(ERR_NOT_ENABLED.into());
        };
        if !self.retry_after(now).is_zero() {
            return Err(ERR_THROTTLED.into());
        }
        if digest_matches(&digest, candidate) {
            self.failed_attempts = 0;
            self.retry_not_before = None;
            return Ok(());
        }
        self.failed_attempts = self.failed_attempts.saturating_add(1);
        self.retry_not_before = retry_delay(self.failed_attempts).map(|delay| now + delay);
        Err(ERR_INVALID_PASSWORD.into())
    }

    /// Set or change the password, replacing the hint with `hint` (a change
    /// of password makes the old hint meaningless, so it is never carried
    /// over implicitly).
    pub fn set_password(
        &mut self,
        current: Option<&str>,
        new_password: &str,
        hint: Option<&str>,
        now: SystemTime,
    ) -> Result<(), String> {
        if self.record.locked {
            return Err(ERR_LOCKED.into());
        }
        validate_new_password(new_password)?;
        let hint = normalize_hint(hint)?;
        if hint_contains(hint.as_deref(), new_password) {
            return Err(ERR_HINT_REVEALS_PASSWORD.into());
        }
        if self.record.password.is_some() {
            self.verify(current.unwrap_or_default(), now)?;
        }
        let mut next = self.record.clone();
        next.password = Some(create_digest(new_password, self.kdf_iterations));
        next.hint = hint;
        self.commit(next)
    }

    /// Replace or remove the hint without touching the password. The
    /// plaintext password is not available here, so the containment check
    /// `set_password` does is reduced to "the hint is not itself the
    /// password" — which is the mistake people actually make.
    pub fn set_hint(&mut self, hint: Option<&str>) -> Result<(), String> {
        if self.record.locked {
            return Err(ERR_LOCKED.into());
        }
        let Some(digest) = self.record.password.clone() else {
            return Err(ERR_NOT_ENABLED.into());
        };
        let hint = normalize_hint(hint)?;
        if let Some(text) = hint.as_deref() {
            if digest_matches(&digest, text) {
                return Err(ERR_HINT_REVEALS_PASSWORD.into());
            }
        }
        let mut next = self.record.clone();
        next.hint = hint;
        self.commit(next)
    }

    pub fn clear_password(&mut self, current: &str, now: SystemTime) -> Result<(), String> {
        if self.record.locked {
            return Err(ERR_LOCKED.into());
        }
        self.verify(current, now)?;
        let mut next = self.record.clone();
        next.password = None;
        next.hint = None;
        next.locked = false;
        self.commit(next)
    }

    pub fn update_preferences(
        &mut self,
        lock_on_launch: bool,
        auto_lock_minutes: u32,
        now: SystemTime,
    ) -> Result<(), String> {
        if self.record.locked {
            return Err(ERR_LOCKED.into());
        }
        if !AUTO_LOCK_MINUTE_CHOICES.contains(&auto_lock_minutes) {
            return Err(ERR_INVALID_AUTO_LOCK.into());
        }
        let mut next = self.record.clone();
        next.lock_on_launch = lock_on_launch;
        next.auto_lock_minutes = auto_lock_minutes;
        // Changing the delay is itself user activity; without this a shorter
        // delay could lock the app under the hand that just picked it.
        self.last_activity = now;
        self.commit(next)
    }

    /// Returns whether the state changed (locking twice is a no-op).
    pub fn lock(&mut self) -> Result<bool, String> {
        if self.record.password.is_none() {
            return Err(ERR_NOT_ENABLED.into());
        }
        if self.record.locked {
            return Ok(false);
        }
        let mut next = self.record.clone();
        next.locked = true;
        self.commit(next)?;
        Ok(true)
    }

    /// `Ok(false)` is a wrong password; `Err` is throttling or a disabled lock.
    pub fn unlock(&mut self, candidate: &str, now: SystemTime) -> Result<bool, String> {
        if !self.record.locked {
            return Ok(true);
        }
        match self.verify(candidate, now) {
            Ok(()) => {
                let mut next = self.record.clone();
                next.locked = false;
                self.last_activity = now;
                self.commit(next)?;
                Ok(true)
            }
            Err(code) if code == ERR_INVALID_PASSWORD => Ok(false),
            Err(code) => Err(code),
        }
    }

    pub fn report_activity(&mut self, now: SystemTime) {
        if !self.record.locked {
            self.last_activity = now;
        }
    }

    /// Whether the idle auto-lock is due at `now`.
    pub fn auto_lock_due(&self, now: SystemTime) -> bool {
        if self.record.password.is_none()
            || self.record.locked
            || self.record.auto_lock_minutes == 0
        {
            return false;
        }
        let threshold = Duration::from_secs(u64::from(self.record.auto_lock_minutes) * 60);
        now.duration_since(self.last_activity)
            .is_ok_and(|idle| idle >= threshold)
    }

    /// Persist first, then adopt: a failed write must not leave memory saying
    /// "locked" while the file a relaunch reads says otherwise.
    fn commit(&mut self, next: LockRecord) -> Result<(), String> {
        write_record(&self.path, &next)?;
        self.record = next;
        Ok(())
    }
}

fn validate_new_password(password: &str) -> Result<(), String> {
    let chars = password.chars().count();
    if chars < MIN_PASSWORD_CHARS {
        return Err(ERR_PASSWORD_TOO_SHORT.into());
    }
    if chars > MAX_PASSWORD_CHARS {
        return Err(ERR_PASSWORD_TOO_LONG.into());
    }
    Ok(())
}

/// Trim the hint, treat blank as "no hint", and bound its length.
fn normalize_hint(hint: Option<&str>) -> Result<Option<String>, String> {
    let Some(text) = hint.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if text.chars().count() > MAX_HINT_CHARS {
        return Err(ERR_HINT_TOO_LONG.into());
    }
    Ok(Some(text.to_owned()))
}

/// Whether the hint spells out the password, ignoring case.
fn hint_contains(hint: Option<&str>, password: &str) -> bool {
    hint.is_some_and(|text| text.to_lowercase().contains(&password.to_lowercase()))
}

/// Delay imposed after `failed_attempts` consecutive wrong passwords: none for
/// the first few, then 30 s doubling up to 15 min.
fn retry_delay(failed_attempts: u32) -> Option<Duration> {
    if failed_attempts < FREE_ATTEMPTS {
        return None;
    }
    let doublings = (failed_attempts - FREE_ATTEMPTS).min(16);
    let delay = BASE_RETRY_DELAY.saturating_mul(1u32 << doublings);
    Some(delay.min(MAX_RETRY_DELAY))
}

fn derive_hash(password: &str, salt: &[u8], iterations: u32) -> [u8; HASH_LEN] {
    let mut out = [0u8; HASH_LEN];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, &mut out);
    out
}

fn create_digest(password: &str, iterations: u32) -> PasswordDigest {
    // Drawn as a value rather than filled into a zeroed buffer: the salt then
    // has no constant anywhere in its history, which is also what lets static
    // analysis see that it is not a hard-coded one.
    let salt: [u8; SALT_LEN] = rand::random();
    let hash = derive_hash(password, &salt, iterations);
    let b64 = base64::engine::general_purpose::STANDARD;
    PasswordDigest {
        algorithm: KDF_ALGORITHM.into(),
        iterations,
        salt: b64.encode(salt),
        hash: b64.encode(hash),
    }
}

fn digest_matches(digest: &PasswordDigest, candidate: &str) -> bool {
    if digest.algorithm != KDF_ALGORITHM || digest.iterations == 0 {
        return false;
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(salt), Ok(expected)) = (b64.decode(&digest.salt), b64.decode(&digest.hash)) else {
        return false;
    };
    if expected.len() != HASH_LEN {
        return false;
    }
    let actual = derive_hash(candidate, &salt, digest.iterations);
    actual.ct_eq(expected.as_slice()).into()
}

fn read_record(path: &Path) -> LockRecord {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return LockRecord::default(),
        Err(err) => {
            tracing::warn!(error = %err, "[AppLock] Could not read lock file; treating lock as disabled");
            return LockRecord::default();
        }
    };
    match serde_json::from_slice::<LockRecord>(&bytes) {
        Ok(record) if record.version == RECORD_VERSION => record,
        Ok(record) => {
            tracing::warn!(
                version = record.version,
                "[AppLock] Unknown lock file version; treating lock as disabled"
            );
            LockRecord::default()
        }
        Err(err) => {
            tracing::warn!(error = %err, "[AppLock] Lock file is not valid JSON; treating lock as disabled");
            LockRecord::default()
        }
    }
}

fn write_record(path: &Path, record: &LockRecord) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(record)
        .map_err(|err| format!("app_lock:serialize_failed: {err}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("app_lock:write_failed: {err}"))?;
    }
    // Write-then-rename so a crash mid-write leaves the previous record, not a
    // truncated file that would read back as "lock disabled".
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|err| format!("app_lock:write_failed: {err}"))?;
    if let Err(err) = app_paths::set_sensitive_file_permissions(&tmp) {
        tracing::warn!(error = %err, "[AppLock] Could not restrict lock file permissions");
    }
    std::fs::rename(&tmp, path).map_err(|err| format!("app_lock:write_failed: {err}"))
}

// ---------------------------------------------------------------------------
// Process-wide state + Tauri surface
// ---------------------------------------------------------------------------

static CORE: OnceLock<Mutex<AppLockCore>> = OnceLock::new();
static IDLE_WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn lock_file_path() -> PathBuf {
    app_paths::orgii_root().join(LOCK_FILE_NAME)
}

fn core() -> MutexGuard<'static, AppLockCore> {
    CORE.get_or_init(|| Mutex::new(AppLockCore::load(lock_file_path(), SystemTime::now())))
        .lock()
        // The guarded state is a plain record; a panicked holder cannot leave
        // it structurally broken, and refusing to serve would wedge the lock
        // screen shut.
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether the app is locked right now. For native entry points that act
/// without going through a window — menu accelerators, the tray, the Dock
/// menu — which the lock page in the webview cannot intercept.
pub fn is_locked() -> bool {
    let guard = core();
    guard.record.password.is_some() && guard.record.locked
}

fn broadcast(app: &tauri::AppHandle, status: &AppLockStatus) {
    if let Err(err) = app.emit(APP_LOCK_CHANGED_EVENT, status) {
        tracing::warn!(error = %err, "[AppLock] Failed to broadcast lock status");
    }
}

/// Load the persisted lock (applying lock-on-launch) and start the idle
/// watcher. Called once from app setup, before any window can ask for status.
pub fn init(app: &tauri::AppHandle) {
    let status = core().status(SystemTime::now());
    tracing::info!(
        enabled = status.enabled,
        locked = status.locked,
        "[AppLock] Initialized"
    );
    if IDLE_WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(IDLE_POLL_INTERVAL).await;
            let locked_status = {
                let mut guard = core();
                let now = SystemTime::now();
                if !guard.auto_lock_due(now) {
                    continue;
                }
                match guard.lock() {
                    Ok(true) => Some(guard.status(now)),
                    Ok(false) => None,
                    Err(err) => {
                        tracing::warn!(error = %err, "[AppLock] Idle auto-lock failed");
                        None
                    }
                }
            };
            if let Some(status) = locked_status {
                tracing::info!("[AppLock] Locked after inactivity");
                broadcast(&app, &status);
            }
        }
    });
}

/// PBKDF2 at 600k rounds is deliberately slow; keep it off the main thread,
/// where sync commands run and would freeze every window.
async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|err| format!("app_lock:task_failed: {err}"))?
}

#[tauri::command]
pub fn app_lock_status() -> AppLockStatus {
    core().status(SystemTime::now())
}

#[tauri::command]
pub async fn app_lock_set_password(
    app: tauri::AppHandle,
    current_password: Option<String>,
    new_password: String,
    hint: Option<String>,
) -> Result<AppLockStatus, String> {
    let status = run_blocking(move || {
        let mut guard = core();
        let now = SystemTime::now();
        guard.set_password(
            current_password.as_deref(),
            &new_password,
            hint.as_deref(),
            now,
        )?;
        Ok(guard.status(now))
    })
    .await?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn app_lock_set_hint(
    app: tauri::AppHandle,
    hint: Option<String>,
) -> Result<AppLockStatus, String> {
    let status = run_blocking(move || {
        let mut guard = core();
        guard.set_hint(hint.as_deref())?;
        Ok(guard.status(SystemTime::now()))
    })
    .await?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn app_lock_clear_password(
    app: tauri::AppHandle,
    current_password: String,
) -> Result<AppLockStatus, String> {
    let status = run_blocking(move || {
        let mut guard = core();
        let now = SystemTime::now();
        guard.clear_password(&current_password, now)?;
        Ok(guard.status(now))
    })
    .await?;
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn app_lock_update_preferences(
    app: tauri::AppHandle,
    lock_on_launch: bool,
    auto_lock_minutes: u32,
) -> Result<AppLockStatus, String> {
    let status = {
        let mut guard = core();
        let now = SystemTime::now();
        guard.update_preferences(lock_on_launch, auto_lock_minutes, now)?;
        guard.status(now)
    };
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn app_lock_lock(app: tauri::AppHandle) -> Result<AppLockStatus, String> {
    let status = {
        let mut guard = core();
        guard.lock()?;
        guard.status(SystemTime::now())
    };
    broadcast(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn app_lock_unlock(
    app: tauri::AppHandle,
    password: String,
) -> Result<AppLockUnlockOutcome, String> {
    let outcome = run_blocking(move || {
        let mut guard = core();
        let now = SystemTime::now();
        let unlocked = guard.unlock(&password, now)?;
        Ok(AppLockUnlockOutcome {
            unlocked,
            status: guard.status(now),
        })
    })
    .await?;
    if outcome.unlocked {
        broadcast(&app, &outcome.status);
    }
    Ok(outcome)
}

#[tauri::command]
pub fn app_lock_report_activity() {
    core().report_activity(SystemTime::now());
}
