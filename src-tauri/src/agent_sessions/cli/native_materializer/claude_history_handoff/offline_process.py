"""Bounded subprocess ownership for disposable native history fixtures."""
from __future__ import annotations

import os
import signal
import subprocess
import tempfile
import time


class InfrastructureError(RuntimeError):
    """The check could not obtain trustworthy compatibility evidence."""


def _stop(process: subprocess.Popen, cleanup_timeout: float = 8) -> None:
    # The Python native drivers handle TERM and reap their separately grouped
    # vendor cores. Allow cleanup before killing any remaining outer group.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    # The group leader (Rust) may exit before its Python fixture has reaped
    # separately grouped vendor children. Give the whole group cleanup time.
    deadline = time.monotonic() + cleanup_timeout
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired as error:
        raise InfrastructureError('owned subprocess could not be reaped') from error


def run_bounded(command, *, cwd=None, env=None, timeout=600,
                max_output=8 * 1024 * 1024, cleanup_timeout=8) -> subprocess.CompletedProcess:
    """Run one owned group; retain bounded output and never launch a retry loop.

    Native test nonzero exits are returned to the caller. Spawn errors, a
    resource limit or timeout are inconclusive infrastructure failures, not
    evidence of schema drift.
    """
    if timeout <= 0 or max_output < 1 or cleanup_timeout <= 0:
        raise ValueError('positive subprocess bounds required')
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            raise InfrastructureError(f'cannot start check: {type(error).__name__}') from error
        deadline = time.monotonic() + timeout
        reason = None
        try:
            while process.poll() is None:
                if os.fstat(output.fileno()).st_size > max_output:
                    reason = 'check exceeded output limit'
                    break
                if time.monotonic() >= deadline:
                    reason = 'check timed out'
                    break
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
            if os.fstat(output.fileno()).st_size > max_output:
                reason = 'check exceeded output limit'
        finally:
            _stop(process, cleanup_timeout)
        if reason:
            raise InfrastructureError(reason)
        output.seek(0)
        text = output.read(max_output).decode('utf-8', errors='replace')
        return subprocess.CompletedProcess(command, process.returncode, text, '')
