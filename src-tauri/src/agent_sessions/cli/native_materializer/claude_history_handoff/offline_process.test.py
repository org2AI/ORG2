#!/usr/bin/env python3
"""Synthetic subprocess lifecycle tests; no provider, network or native App."""
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import offline_process as support


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


@unittest.skipUnless(hasattr(os, "killpg"), "requires POSIX process groups")
class RunnerTests(unittest.TestCase):
    def test_combines_output_and_preserves_zero_or_nonzero_exit(self):
        for code in [0, 7]:
            result = support.run_bounded([sys.executable, "-c", f"import sys; print('stdout',flush=True); print('stderr',file=sys.stderr,flush=True); sys.exit({code})"], timeout=3)
            self.assertEqual(result.returncode, code)
            self.assertIn("stdout", result.stdout)
            self.assertIn("stderr", result.stdout)
            self.assertEqual(result.stderr, "")

    def test_preserves_explicit_working_directory_and_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            result = support.run_bounded([sys.executable, "-c", "import os; print(os.getcwd()); print(os.environ['CANARY_TEST_VALUE'])"], cwd=directory, env={"CANARY_TEST_VALUE": "isolated"}, timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(Path(result.stdout.splitlines()[0]).resolve(), Path(directory).resolve())
            self.assertIn("isolated", result.stdout)

    def test_invalid_limits_do_not_start_a_process(self):
        with patch.object(support.subprocess, "Popen") as start:
            for options in [{"timeout": 0}, {"timeout": -1}, {"max_output": 0}]:
                with self.assertRaises(ValueError):
                    support.run_bounded(["unused"], **options)
            start.assert_not_called()

    def test_spawn_failure_is_infrastructure(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(support.InfrastructureError, "cannot start"):
                support.run_bounded([str(Path(directory) / "absent")], timeout=1)

    def test_output_limit_applies_even_after_successful_process_exit(self):
        with self.assertRaisesRegex(support.InfrastructureError, "output limit"):
            support.run_bounded([sys.executable, "-c", "print('x' * 4096)"], timeout=3, max_output=128)

    def test_timeout_allows_fixture_to_reap_separately_grouped_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "fixture.py"
            script.write_text("""import json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(sys.argv[1])
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'], start_new_session=True)
(root/'pids.json').write_text(json.dumps([os.getpid(),child.pid]))
def stop(*_):
    child.terminate()
    code=child.wait(timeout=2)
    (root/'reaped').write_text(str(code))
    raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
while True: time.sleep(0.05)
""")
            pids = []
            try:
                with self.assertRaisesRegex(support.InfrastructureError, "timed out"):
                    support.run_bounded([sys.executable, str(script), directory], timeout=0.6)
                import json
                pids = json.loads((root / "pids.json").read_text())
                self.assertTrue((root / "reaped").is_file(), "fixture did not receive a cleanup grace period")
                self.assertTrue(all(not alive(pid) for pid in pids), "owned subprocess survived timeout")
            finally:
                if not pids and (root / "pids.json").is_file():
                    import json
                    pids = json.loads((root / "pids.json").read_text())
                for pid in pids:
                    if alive(pid):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_normal_leader_exit_still_waits_for_descendant_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child_script = root / "child.py"
            child_script.write_text("""import os,pathlib,signal,sys,time
root=pathlib.Path(sys.argv[1])
def stop(*_):
    time.sleep(0.2)
    (root/'cleaned').write_text('done')
    raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
(root/'child.pid').write_text(str(os.getpid()))
while True: time.sleep(0.02)
""")
            leader = root / "leader.py"
            leader.write_text("""import pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1])
subprocess.Popen([sys.executable,str(root/'child.py'),str(root)])
while not (root/'child.pid').exists(): time.sleep(0.01)
""")
            child_pid = None
            try:
                result = support.run_bounded([sys.executable, str(leader), directory], timeout=3)
                child_pid = int((root / "child.pid").read_text())
                self.assertEqual(result.returncode, 0)
                self.assertTrue((root / "cleaned").exists(), "runner killed descendant before cleanup finished")
                deadline = time.monotonic() + 2
                while alive(child_pid) and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertFalse(alive(child_pid), "descendant remained after leader completed")
            finally:
                if child_pid is None and (root / "child.pid").exists():
                    child_pid = int((root / "child.pid").read_text())
                if child_pid and alive(child_pid):
                    try:
                        os.kill(child_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_stop_kills_and_reaps_process_that_ignores_term_after_grace(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / "ready"
            code = "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(sys.argv[1]).write_text('ready'); time.sleep(60)"
            process = subprocess.Popen([sys.executable, "-c", code, str(ready)], start_new_session=True)
            try:
                deadline = time.monotonic() + 3
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists())
                # Exercise hard-kill fallback without waiting the production
                # eight-second grace; the real grace path is covered above.
                with patch.object(support.time, "monotonic", side_effect=[0, 9]):
                    support._stop(process)
                self.assertEqual(process.returncode, -signal.SIGKILL)
                self.assertFalse(alive(process.pid))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
