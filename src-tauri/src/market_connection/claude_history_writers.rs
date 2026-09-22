//! One owner-scoped, event-driven wait for a bounded snapshot of Claude writers.
//! Exit signals invalidate the snapshot; they never authorize transcript writes.
#[cfg(target_os = "macos")]
mod platform {
    use super::super::native_app_launch::{claude_writer_identities, writer_identity_current};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread::JoinHandle;

    const WAKE: usize = 1;
    pub(crate) struct Guard {
        queue: Arc<OwnedFd>,
        cancelled: Arc<AtomicBool>,
        completed: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }
    fn change(queue: &OwnedFd, event: libc::kevent) -> Result<(), String> {
        // SAFETY: synchronous submission of one initialized event; no output buffer.
        if unsafe {
            libc::kevent(
                queue.as_raw_fd(),
                &event,
                1,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
            )
        } < 0
        {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }
    fn event(ident: usize, filter: i16, flags: u16, fflags: u32) -> libc::kevent {
        libc::kevent {
            ident,
            filter,
            flags,
            fflags,
            data: 0,
            udata: std::ptr::null_mut(),
        }
    }
    impl Guard {
        /// Published before the callback so its wake cannot be consumed too early.
        pub(crate) fn is_finished(&self) -> bool {
            self.completed.load(Ordering::Acquire)
                || self.thread.as_ref().is_none_or(JoinHandle::is_finished)
        }
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            self.cancelled.store(true, Ordering::Release);
            let _ = change(
                &self.queue,
                event(WAKE, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER),
            );
            if let Some(thread) = self.thread.take() {
                // The wait has a bounded cancellation fallback if triggering fails.
                let _ = thread.join();
            }
        }
    }
    pub(crate) fn watch_busy(
        on_exit: impl Fn() + Send + Sync + 'static,
    ) -> Result<Option<Guard>, String> {
        let identities = claude_writer_identities().map_err(str::to_owned)?;
        if identities.is_empty() {
            return Ok(None);
        }
        // SAFETY: kqueue returns a new descriptor, transferred to OwnedFd exactly once.
        let fd = unsafe { libc::kqueue() };
        if fd < 0 {
            return Err("Cannot subscribe to Claude process exits".into());
        }
        let queue = Arc::new(unsafe { OwnedFd::from_raw_fd(fd) });
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err("Cannot protect Claude process subscription".into());
        }
        change(
            &queue,
            event(WAKE, libc::EVFILT_USER, libc::EV_ADD | libc::EV_CLEAR, 0),
        )?;
        for identity in identities {
            let registration = event(
                identity.pid as usize,
                libc::EVFILT_PROC,
                libc::EV_ADD | libc::EV_ONESHOT,
                libc::NOTE_EXIT,
            );
            let registered = change(&queue, registration);
            let current = writer_identity_current(&identity).map_err(str::to_owned)?;
            if !current {
                // Lost identity, including exit during registration: request a fresh snapshot.
                on_exit();
                return Ok(None);
            }
            registered?;
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let completed = Arc::new(AtomicBool::new(false));
        let worker_completed = completed.clone();
        let worker_queue = queue.clone();
        let worker_cancelled = cancelled.clone();
        let thread = std::thread::Builder::new()
            .name("claude-history-exit".into())
            .spawn(move || {
                while !worker_cancelled.load(Ordering::Acquire) {
                    let mut output = event(0, 0, 0, 0);
                    // Cancellation safety only: timeout never scans processes, retries sync,
                    // or invokes callbacks. Normal teardown uses the EVFILT_USER wake.
                    let timeout = libc::timespec {
                        tv_sec: 1,
                        tv_nsec: 0,
                    };
                    let count = unsafe {
                        libc::kevent(
                            worker_queue.as_raw_fd(),
                            std::ptr::null(),
                            0,
                            &mut output,
                            1,
                            &timeout,
                        )
                    };
                    if worker_cancelled.load(Ordering::Acquire) {
                        return;
                    }
                    if count < 0
                        && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
                    {
                        continue;
                    }
                    if count != 0 {
                        // Error and exit both invalidate our snapshot. The owner must recheck.
                        worker_completed.store(true, Ordering::Release);
                        on_exit();
                        return;
                    }
                }
            })
            .map_err(|_| "Cannot start Claude process subscription".to_owned())?;
        Ok(Some(Guard {
            queue,
            cancelled,
            completed,
            thread: Some(thread),
        }))
    }
}
#[cfg(target_os = "macos")]
pub(crate) use platform::{watch_busy, Guard};

pub(super) fn writers_closed() -> Result<(), &'static str> {
    super::native_app_launch::claude_history_writers_closed()
}
