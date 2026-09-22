use super::*;
use std::{cell::Cell, collections::VecDeque};
const BOOT: &[u8] = b"12345678-1234-1234-1234-123456789abc\0";
fn identity(pid: i32) -> Identity {
    Identity {
        pid,
        started: (123, 456),
    }
}
#[derive(Default)]
struct Fake {
    results: VecDeque<Result<Option<Identity>, String>>,
    dispatches: usize,
    activated: Vec<Identity>,
    dispatch_error: bool,
    spawn_error: bool,
}
impl Runtime for Fake {
    fn find(&mut self) -> Result<Option<Identity>, String> {
        self.results.pop_front().unwrap_or(Ok(None))
    }
    fn activate(&mut self, identity: &Identity) -> Result<(), String> {
        self.activated.push(identity.clone());
        Ok(())
    }
    fn dispatch(&mut self) -> Result<(), super::super::DispatchFailure> {
        self.dispatches += 1;
        if self.spawn_error {
            return Err(super::super::DispatchFailure {
                started: false,
                message: "not started",
            });
        }
        if self.dispatch_error {
            Err(super::super::DispatchFailure {
                started: true,
                message: "dispatcher timed out",
            })
        } else {
            Ok(())
        }
    }
}
fn reservation() -> (tempfile::TempDir, File) {
    let dir = tempfile::tempdir().unwrap();
    let file = lock(&dir.path().join("launch.lock")).unwrap();
    (dir, file)
}
#[test]
fn repeated_open_reuses_exact_identity_without_spawning() {
    let (_dir, mut file) = reservation();
    let mut runtime = Fake {
        results: vec![Ok(Some(identity(7))), Ok(Some(identity(7)))].into(),
        ..Fake::default()
    };
    for _ in 0..2 {
        run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).unwrap();
    }
    assert_eq!(runtime.dispatches, 0);
    assert_eq!(runtime.activated, vec![identity(7), identity(7)]);
}
#[test]
fn fresh_launch_holds_reservation_until_verified_process_and_allows_exit_relaunch() {
    let (_dir, mut file) = reservation();
    let mut runtime = Fake {
        results: vec![
            Ok(None),
            Ok(Some(identity(7))),
            Ok(None),
            Ok(Some(identity(8))),
        ]
        .into(),
        ..Fake::default()
    };
    for _ in 0..2 {
        run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).unwrap();
    }
    assert_eq!(runtime.dispatches, 2);
    assert_eq!(runtime.activated, vec![identity(7), identity(8)]);
    assert!(!pending(&mut file, BOOT).unwrap());
}
#[test]
fn startup_timeout_or_dispatch_error_blocks_retry_even_after_reservation_reopen() {
    for dispatch_error in [false, true] {
        let (dir, mut file) = reservation();
        let mut runtime = Fake {
            dispatch_error,
            ..Fake::default()
        };
        assert!(run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).is_err());
        drop(file);
        let mut file = lock(&dir.path().join("launch.lock")).unwrap();
        assert!(
            run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO)
                .unwrap_err()
                .contains("earlier")
        );
        assert_eq!(runtime.dispatches, 1);
        runtime.results.push_back(Ok(Some(identity(7))));
        run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).unwrap();
        assert_eq!(runtime.dispatches, 1);
        assert!(!pending(&mut file, BOOT).unwrap());
    }
}
#[test]
fn uncertain_state_only_recovers_after_observation_or_an_actual_new_boot() {
    let (_dir, mut file) = reservation();
    record(&mut file, BOOT).unwrap();
    let new_boot = b"87654321-1234-1234-1234-123456789abc\0";
    let mut runtime = Fake {
        results: vec![Ok(None), Ok(Some(identity(7)))].into(),
        ..Fake::default()
    };
    run(&mut file, new_boot, || Ok(()), &mut runtime, Duration::ZERO).unwrap();
    assert_eq!(runtime.dispatches, 1);
    record(&mut file, b"incomplete").unwrap();
    assert!(pending(&mut file, new_boot).is_err());
}
#[test]
fn unknown_or_multiple_processes_never_dispatch_or_activate() {
    let (_dir, mut file) = reservation();
    for error in ["Cannot inspect", "Multiple processes"] {
        record(&mut file, BOOT).unwrap();
        let mut runtime = Fake {
            results: vec![Err(error.into())].into(),
            ..Fake::default()
        };
        assert!(run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).is_err());
        assert_eq!(runtime.dispatches, 0);
        assert!(runtime.activated.is_empty());
        assert!(pending(&mut file, BOOT).unwrap());
    }
}
#[test]
fn owner_change_before_reuse_or_spawn_refuses_side_effect() {
    for found in [None, Some(identity(7))] {
        let (_dir, mut file) = reservation();
        let count = Cell::new(0);
        let mut runtime = Fake {
            results: vec![Ok(found)].into(),
            ..Fake::default()
        };
        let check = || {
            count.set(count.get() + 1);
            if count.get() >= 2 {
                Err("owner changed".into())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            run(&mut file, BOOT, check, &mut runtime, Duration::ZERO).unwrap_err(),
            "owner changed"
        );
        assert_eq!(runtime.dispatches, 0);
        assert!(runtime.activated.is_empty());
    }
}
#[test]
fn same_profile_lock_refuses_concurrent_open_and_rejects_symlink_or_hardlink() {
    let (dir, file) = reservation();
    let path = dir.path().join("launch.lock");
    assert!(lock(&path).is_err());
    drop(file);
    // Parallel subprocess tests may briefly inherit the open file description
    // between fork and exec. O_CLOEXEC closes it at exec, not at parent drop.
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match lock(&path) {
            Ok(file) => {
                drop(file);
                break;
            }
            Err(error) => {
                assert!(Instant::now() < deadline, "Lock was not released: {error}");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
    let link = dir.path().join("symlink");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert!(lock(&link).is_err());
    let hard = dir.path().join("hardlink");
    std::fs::hard_link(&path, &hard).unwrap();
    assert!(lock(&hard).is_err());
}

#[test]
fn separate_process_cannot_acquire_the_same_profile_launch_reservation() {
    let (dir, _file) = reservation();
    let mut child = super::super::tests::FixtureChild(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "market_connection::native_app_launch::lifecycle::tests::reservation_child",
                "--exact",
            ])
            .env(
                "ORG2_LAUNCH_TEST_RESERVATION",
                dir.path().join("launch.lock"),
            )
            .spawn()
            .unwrap(),
    );
    let status = child
        .wait_for(Duration::from_secs(5))
        .unwrap()
        .expect("reservation fixture timed out");
    assert!(status.success());
}
#[test]
fn reservation_child() {
    if let Some(path) = std::env::var_os("ORG2_LAUNCH_TEST_RESERVATION") {
        assert!(lock(Path::new(&path)).is_err());
    }
}

#[test]
fn known_spawn_failure_and_pre_dispatch_owner_change_release_reservation() {
    let (_dir, mut file) = reservation();
    let mut runtime = Fake {
        spawn_error: true,
        ..Fake::default()
    };
    assert_eq!(
        run(&mut file, BOOT, || Ok(()), &mut runtime, Duration::ZERO).unwrap_err(),
        "not started"
    );
    assert!(!pending(&mut file, BOOT).unwrap());
    let count = Cell::new(0);
    let mut runtime = Fake::default();
    let check = || {
        count.set(count.get() + 1);
        if count.get() == 3 {
            Err("changed before dispatch".into())
        } else {
            Ok(())
        }
    };
    assert_eq!(
        run(&mut file, BOOT, check, &mut runtime, Duration::ZERO).unwrap_err(),
        "changed before dispatch"
    );
    assert_eq!(runtime.dispatches, 0);
    assert!(!pending(&mut file, BOOT).unwrap());
}
