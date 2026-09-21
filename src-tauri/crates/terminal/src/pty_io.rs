//! Session-owned, cancellation-aware PTY I/O. Unix waits on kernel readiness;
//! ConPTY synchronous pipe operations run on owned, cancellable native threads.
use std::io::{self, Read, Write};
use std::sync::Arc;
use tokio::sync::watch;

pub struct IoStop(watch::Sender<bool>);
impl Default for IoStop {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl IoStop {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub async fn cancelled(&self) {
        let mut rx = self.0.subscribe();
        if *rx.borrow_and_update() {
            return;
        }
        let _ = rx.changed().await;
    }
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
}
fn closed() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "PTY session closed")
}

pub struct PtyReader {
    inner: Option<Box<dyn Read + Send>>,
    stop: Arc<IoStop>,
    #[cfg(unix)]
    ready: tokio::io::unix::AsyncFd<std::os::fd::OwnedFd>,
}
pub struct PtyWriter {
    inner: Option<Box<dyn Write + Send>>,
    stop: Arc<IoStop>,
    #[cfg(unix)]
    ready: tokio::io::unix::AsyncFd<std::os::fd::OwnedFd>,
}

#[cfg(unix)]
fn readiness(
    master: &dyn portable_pty::MasterPty,
    interest: tokio::io::Interest,
) -> io::Result<tokio::io::unix::AsyncFd<std::os::fd::OwnedFd>> {
    use std::os::fd::{FromRawFd, OwnedFd};
    let fd = master
        .as_raw_fd()
        .ok_or_else(|| io::Error::other("PTY has no readiness fd"))?;
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let duplicated = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if duplicated < 0 {
        return Err(io::Error::last_os_error());
    }
    let owned = unsafe { OwnedFd::from_raw_fd(duplicated) };
    tokio::io::unix::AsyncFd::with_interest(owned, interest)
}

pub fn wrap(
    master: &dyn portable_pty::MasterPty,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
) -> io::Result<(PtyReader, PtyWriter, Arc<IoStop>)> {
    #[cfg(windows)]
    let _ = master;
    let stop = Arc::new(IoStop::default());
    Ok((
        PtyReader {
            inner: Some(reader),
            stop: stop.clone(),
            #[cfg(unix)]
            ready: readiness(master, tokio::io::Interest::READABLE)?,
        },
        PtyWriter {
            inner: Some(writer),
            stop: stop.clone(),
            #[cfg(unix)]
            ready: readiness(master, tokio::io::Interest::WRITABLE)?,
        },
        stop,
    ))
}

impl PtyReader {
    pub async fn read(&mut self, max: usize) -> io::Result<Vec<u8>> {
        if self.stop.is_cancelled() {
            return Err(closed());
        }
        #[cfg(unix)]
        {
            let mut bytes = vec![0; max];
            loop {
                let mut guard = tokio::select! {
                    biased;
                    _ = self.stop.cancelled() => return Err(closed()),
                    ready = self.ready.readable() => ready?,
                };
                match guard.try_io(|_| self.inner.as_mut().expect("live reader").read(&mut bytes)) {
                    Ok(Ok(n)) => {
                        bytes.truncate(n);
                        return Ok(bytes);
                    }
                    Ok(Err(error)) => return Err(error),
                    Err(_) => continue,
                }
            }
        }
        #[cfg(windows)]
        {
            let reader = self.inner.take().ok_or_else(closed)?;
            let (reader, result) = windows::operation(reader, self.stop.clone(), move |reader| {
                let mut bytes = vec![0; max];
                let n = reader.read(&mut bytes)?;
                bytes.truncate(n);
                Ok(bytes)
            })
            .await?;
            self.inner = Some(reader);
            result
        }
    }
}
impl PtyWriter {
    pub async fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.stop.is_cancelled() {
            return Err(closed());
        }
        #[cfg(unix)]
        {
            let mut remaining = bytes;
            while !remaining.is_empty() {
                let mut guard = tokio::select! {
                    biased;
                    _ = self.stop.cancelled() => return Err(closed()),
                    ready = self.ready.writable() => ready?,
                };
                match guard.try_io(|_| self.inner.as_mut().expect("live writer").write(remaining)) {
                    Ok(Ok(0)) => {
                        return Err(io::Error::new(
                            io::ErrorKind::WriteZero,
                            "PTY write made no progress",
                        ))
                    }
                    Ok(Ok(n)) => remaining = &remaining[n..],
                    Ok(Err(error)) => return Err(error),
                    Err(_) => continue,
                }
            }
            // portable-pty's Unix FileDescriptor writer flush is a no-op;
            // bytes are already submitted to the kernel, not a buffered sink.
            Ok(())
        }
        #[cfg(windows)]
        {
            let writer = self.inner.take().ok_or_else(closed)?;
            let bytes = bytes.to_vec();
            let (writer, result) = windows::operation(writer, self.stop.clone(), move |writer| {
                writer.write_all(&bytes)?;
                writer.flush()
            })
            .await?;
            self.inner = Some(writer);
            result
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::thread::JoinHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn CancelSynchronousIo(thread: *mut std::ffi::c_void) -> i32;
    }
    struct OwnedOperation(Option<JoinHandle<()>>);
    impl Drop for OwnedOperation {
        fn drop(&mut self) {
            if let Some(worker) = self.0.take() {
                // Also runs when the RPC future is dropped. The native handle
                // stays owned until join; repeated cancellation closes the
                // check-before-entering-ReadFile race. This thread exists only
                // during shutdown, never as an idle polling loop.
                std::thread::spawn(move || {
                    while !worker.is_finished() {
                        unsafe {
                            CancelSynchronousIo(worker.as_raw_handle());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    let _ = worker.join();
                });
            }
        }
    }
    pub async fn operation<T: Send + 'static, R: Send + 'static>(
        mut io: T,
        stop: Arc<IoStop>,
        call: impl FnOnce(&mut T) -> io::Result<R> + Send + 'static,
    ) -> io::Result<(T, io::Result<R>)> {
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        let worker_stop = stop.clone();
        let worker = std::thread::Builder::new()
            .name("pty-io".into())
            .spawn(move || {
                let result = if worker_stop.is_cancelled() {
                    Err(closed())
                } else {
                    call(&mut io)
                };
                let _ = tx.send((io, result));
            })?;
        let mut owned = OwnedOperation(Some(worker));
        tokio::select! {
            result = &mut rx => {
                let result = result.map_err(|_| io::Error::other("PTY I/O worker failed"));
                if let Some(worker) = owned.0.take() {
                    tokio::task::spawn_blocking(move || worker.join()).await.map_err(io::Error::other)?.map_err(|_| io::Error::other("PTY I/O worker panicked"))?;
                }
                result
            },
            _ = stop.cancelled() => {
                // Cancel until the operation's completion is observed, then
                // join before reporting session closure to its owner.
                while !owned.0.as_ref().expect("owned worker").is_finished() {
                    unsafe { CancelSynchronousIo(owned.0.as_ref().expect("owned worker").as_raw_handle()); }
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
                if let Some(worker) = owned.0.take() { let _ = worker.join(); }
                Err(closed())
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Duration;
    struct Shell(Option<Box<dyn portable_pty::Child + Send>>);
    impl Drop for Shell {
        fn drop(&mut self) {
            if let Some(mut child) = self.0.take() {
                let _ = child.kill();
                // Panic cleanup must let the surrounding PTY handles drop
                // before waiting for the Darwin terminal exit path.
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
            }
        }
    }
    impl Shell {
        fn reap(mut self) {
            if let Some(mut child) = self.0.take() {
                let _ = child.kill();
                child.wait().unwrap();
            }
        }
    }
    fn start(
        command: &str,
    ) -> (
        portable_pty::PtyPair,
        Shell,
        Box<dyn Read + Send>,
        Box<dyn Write + Send>,
    ) {
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let mut command_builder = portable_pty::CommandBuilder::new("/bin/sh");
        command_builder.args(["-c", command]);
        let child = pair.slave.spawn_command(command_builder).unwrap();
        (pair, Shell(Some(child)), reader, writer)
    }
    #[tokio::test(flavor = "current_thread")]
    async fn idle_reader_yields_to_timer_and_cancels_without_killing_the_shell() {
        let (pair, mut shell, reader, writer) = start("sleep 30");
        let (mut reader, _writer, stop) = wrap(pair.master.as_ref(), reader, writer).unwrap();
        let read = tokio::spawn(async move { reader.read(1024).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!read.is_finished());
        stop.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), read)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::Interrupted);
        assert!(shell.0.as_mut().unwrap().try_wait().unwrap().is_none());
        drop(_writer);
        drop(pair);
        shell.reap();
    }
    #[tokio::test(flavor = "current_thread")]
    async fn full_input_pipe_is_cancellable_and_does_not_starve_timers() {
        let (pair, shell, reader, writer) = start("sleep 30");
        // Isolate stdin backpressure: canonical echo otherwise creates a
        // second, undrained output stream unrelated to the writer contract.
        let fd = pair.master.as_raw_fd().unwrap();
        unsafe {
            let mut termios = std::mem::zeroed();
            assert_eq!(libc::tcgetattr(fd, &mut termios), 0);
            libc::cfmakeraw(&mut termios);
            assert_eq!(libc::tcsetattr(fd, libc::TCSANOW, &termios), 0);
        }

        let (_reader, mut writer, stop) = wrap(pair.master.as_ref(), reader, writer).unwrap();
        let write =
            tokio::spawn(async move { writer.write_all(&vec![b'x'; 8 * 1024 * 1024]).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!write.is_finished());
        stop.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), write)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::Interrupted);
        unsafe {
            libc::tcflush(pair.master.as_raw_fd().unwrap(), libc::TCIOFLUSH);
        }
        drop(_reader);
        drop(pair);
        shell.reap();
    }
    #[tokio::test(flavor = "current_thread")]
    async fn native_chunked_output_reaches_safe_snapshot_and_preserves_utf8() {
        let (pair, shell, reader, writer) = start("printf OPENAI_API_; sleep 0.05; printf 'KEY=not-a-real-secret-value\\n'; printf '\\342'; sleep 0.05; printf '\\224\\200\\n'");
        let (mut reader, _writer, _stop) = wrap(pair.master.as_ref(), reader, writer).unwrap();
        let mut snapshot = crate::stream_snapshot::StreamSnapshot::default();
        tokio::time::timeout(Duration::from_secs(3), async {
            while !snapshot.replay().contains('─') {
                let bytes = reader.read(1024).await.unwrap();
                assert!(!bytes.is_empty());
                snapshot.push(&bytes);
                assert!(!snapshot.inspection().contains("not-a-real-secret-value"));
            }
        })
        .await
        .unwrap();
        assert!(snapshot.inspection().contains("secret_*******"));
        assert!(!snapshot.replay().contains('\u{fffd}'));
        assert_eq!(snapshot.covers_seq(), snapshot.replay().len() as u64);
        drop(reader);
        drop(_writer);
        drop(pair);
        shell.reap();
    }
}
