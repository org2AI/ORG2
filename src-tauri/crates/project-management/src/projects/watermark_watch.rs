//! Native invalidation of the durable PM watermark. Filesystem events are
//! hints only: callers must still read the committed SQLite sequence.
#[cfg(any(not(target_os = "macos"), test))]
use notify::Event;
#[cfg(not(target_os = "macos"))]
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
#[cfg(target_os = "macos")]
type NativeWatcher = tokio::io::unix::AsyncFd<kqueue::Watcher>;
#[cfg(not(target_os = "macos"))]
type NativeWatcher = RecommendedWatcher;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tokio::time::Instant;

const SAFETY_CHECK: Duration = Duration::from_secs(5 * 60);
const MIN_CHECK_GAP: Duration = Duration::from_secs(2);
const REARM_INTERVAL: Duration = Duration::from_secs(60);

pub struct WatermarkWake {
    path: PathBuf,
    watcher: Option<NativeWatcher>,
    signal: Arc<Notify>,
    failed: Arc<AtomicBool>,
    next_rearm: Instant,
    last_check: Instant,
    first: bool,
}

impl WatermarkWake {
    pub async fn new(path: PathBuf) -> Self {
        let mut owner = Self {
            path,
            watcher: None,
            signal: Arc::new(Notify::new()),
            failed: Arc::new(AtomicBool::new(false)),
            next_rearm: Instant::now(),
            last_check: Instant::now(),
            first: true,
        };
        owner.arm().await;
        owner
    }

    async fn arm(&mut self) {
        self.watcher = None;
        self.failed.store(false, Ordering::Release);
        self.next_rearm = Instant::now() + REARM_INTERVAL;
        let path = self.path.clone();
        let signal = self.signal.clone();
        let failed = self.failed.clone();
        let result = tokio::task::spawn_blocking(move || native_watch(path, signal, failed))
            .await
            .map_err(|err| err.to_string())
            .and_then(|result| result);
        match result {
            Ok(watcher) => self.watcher = Some(watcher),
            Err(err) => tracing::warn!(
                "[pm-watermark] native watch unavailable; using 2s fallback: {}",
                err
            ),
        }
    }

    /// Retain the existing bounded recovery cadence after a failed read or
    /// unacknowledged durable consumer window.
    pub fn retry_soon(&self) {
        self.signal.notify_one();
    }

    /// One consumer, one pending signal. Bursts are coalesced and never cause
    /// more reads than the previous 2s loop. Quiet healthy databases use only
    /// a five-minute safety read. Errors retain the original recovery cadence.
    pub async fn wait(&mut self) {
        if self.first {
            self.first = false;
            self.last_check = Instant::now();
            return; // re-read once after arming; do not lose the startup race
        }
        if (self.watcher.is_none() || self.failed.load(Ordering::Acquire))
            && Instant::now() >= self.next_rearm
        {
            self.arm().await;
            self.signal.notify_one();
        }
        let safety = if self.watcher.is_none() || self.failed.load(Ordering::Acquire) {
            MIN_CHECK_GAP
        } else {
            SAFETY_CHECK
        };
        tokio::select! {
            _ = self.signal.notified() => {}
            result = native_changed(&self.watcher) => {
                if result.is_err() { self.failed.store(true, Ordering::Release); }
            }
            _ = tokio::time::sleep(safety) => {}
        }
        tokio::time::sleep_until(self.last_check + MIN_CHECK_GAP).await;
        self.last_check = Instant::now();
        // Kqueue watches inodes. Reopen the bounded set before the sequence
        // read to follow WAL rotation without losing a replacement's writes.
        #[cfg(target_os = "macos")]
        if self.watcher.is_some() && !self.failed.load(Ordering::Acquire) {
            self.arm().await;
        }
    }
}

#[cfg(target_os = "macos")]
fn native_watch(
    path: PathBuf,
    _: Arc<Notify>,
    _: Arc<AtomicBool>,
) -> Result<NativeWatcher, String> {
    use kqueue::{EventFilter, FilterFlag};
    let mut watcher = kqueue::Watcher::new().map_err(|err| err.to_string())?;
    let parent = path.parent().ok_or("database has no parent")?;
    let flags = FilterFlag::NOTE_WRITE
        | FilterFlag::NOTE_EXTEND
        | FilterFlag::NOTE_DELETE
        | FilterFlag::NOTE_RENAME
        | FilterFlag::NOTE_REVOKE;
    watcher
        .add_filename(parent, EventFilter::EVFILT_VNODE, flags)
        .map_err(|err| err.to_string())?;
    for suffix in ["", "-wal", "-journal"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        match watcher.add_filename(Path::new(&name), EventFilter::EVFILT_VNODE, flags) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.to_string()),
        }
    }
    watcher.watch().map_err(|err| err.to_string())?;
    tokio::io::unix::AsyncFd::with_interest(watcher, tokio::io::Interest::READABLE)
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "macos")]
async fn native_changed(watcher: &Option<NativeWatcher>) -> std::io::Result<()> {
    match watcher {
        Some(watcher) => {
            let _ready = watcher.readable().await?;
            Ok(())
        }
        None => std::future::pending().await,
    }
}

#[cfg(not(target_os = "macos"))]
async fn native_changed(_: &Option<NativeWatcher>) -> std::io::Result<()> {
    std::future::pending().await
}

#[cfg(not(target_os = "macos"))]
fn native_watch(
    path: PathBuf,
    signal: Arc<Notify>,
    failed: Arc<AtomicBool>,
) -> Result<NativeWatcher, String> {
    let parent = path
        .parent()
        .ok_or("database has no parent")?
        .canonicalize()
        .map_err(|err| err.to_string())?;
    let database = parent.join(path.file_name().ok_or("database has no name")?);
    let mut watcher =
        notify::recommended_watcher(move |event: notify::Result<Event>| match event {
            Ok(event) if affects_database(&event, &database) => signal.notify_one(),
            Err(_) => {
                failed.store(true, Ordering::Release);
                signal.notify_one();
            }
            _ => {}
        })
        .map_err(|err| err.to_string())?;
    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;
    Ok(watcher)
}

#[cfg(any(not(target_os = "macos"), test))]
fn affects_database(event: &Event, database: &Path) -> bool {
    if event.kind.is_access() {
        return false;
    }
    event.paths.iter().any(|path| {
        if path == database {
            return true;
        }
        ["-wal", "-journal"].iter().any(|suffix| {
            let mut name = database.as_os_str().to_os_string();
            name.push(suffix);
            path == Path::new(&name)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, ModifyKind};

    #[test]
    fn matches_database_replacement_and_journals_but_not_reads_or_siblings() {
        let db = Path::new("/isolated/projects.db");
        for path in [
            "/isolated/projects.db",
            "/isolated/projects.db-wal",
            "/isolated/projects.db-journal",
        ] {
            let event =
                Event::new(notify::EventKind::Modify(ModifyKind::Any)).add_path(path.into());
            assert!(affects_database(&event, db));
        }
        let sibling = Event::new(notify::EventKind::Any).add_path("/other/projects.db-wal".into());
        assert!(!affects_database(&sibling, db));
        let read = Event::new(notify::EventKind::Access(AccessKind::Read)).add_path(db.into());
        assert!(!affects_database(&read, db));
    }

    #[tokio::test]
    async fn native_wal_write_wakes_committed_sequence_reader() {
        let sandbox = tempfile::tempdir().unwrap();
        let path = sandbox.path().join("watermark.db");
        let reader = rusqlite::Connection::open(&path).unwrap();
        reader.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE seq(value INTEGER); INSERT INTO seq VALUES(0);").unwrap();
        let mut wake = WatermarkWake::new(path.clone()).await;
        assert!(wake.watcher.is_some());
        wake.wait().await;
        let writer = rusqlite::Connection::open(&path).unwrap();
        writer.execute("UPDATE seq SET value=1", []).unwrap();
        tokio::time::timeout(Duration::from_secs(6), wake.wait())
            .await
            .unwrap();
        assert_eq!(
            reader
                .query_row("SELECT value FROM seq", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        // Reads must not self-wake, and a quiet watcher must not retain the
        // previous two-second poll. Keep both SQLite handles open throughout.
        assert!(
            tokio::time::timeout(Duration::from_millis(2200), wake.wait())
                .await
                .is_err()
        );
        writer.execute("UPDATE seq SET value=2", []).unwrap();
        tokio::time::timeout(Duration::from_secs(6), wake.wait())
            .await
            .unwrap();
        assert_eq!(
            reader
                .query_row("SELECT value FROM seq", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        // Closing the last handle checkpoints/removes WAL. The parent watch
        // must also follow the newly created journal on the next connection.
        drop(writer);
        drop(reader);
        let replacement = rusqlite::Connection::open(&path).unwrap();
        replacement.execute("UPDATE seq SET value=3", []).unwrap();
        tokio::time::timeout(Duration::from_secs(6), wake.wait())
            .await
            .unwrap();
        assert_eq!(
            replacement
                .query_row("SELECT value FROM seq", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            3
        );
        // Dropping the owner drops its native watcher; there is no detached
        // polling task or per-event queue retained by this API.
    }

    #[tokio::test]
    async fn signal_bursts_have_one_pending_wake_and_a_minimum_gap() {
        let mut wake = WatermarkWake::new(PathBuf::from("/missing-parent/watermark.db")).await;
        wake.wait().await;
        for _ in 0..100 {
            wake.signal.notify_one();
        }
        let started = Instant::now();
        wake.wait().await;
        assert!(started.elapsed() >= MIN_CHECK_GAP);
        assert!(
            tokio::time::timeout(Duration::from_millis(20), wake.signal.notified())
                .await
                .is_err()
        );
    }
}
