"""Export disposable native writebacks for the Rust production adapter tests."""
import hashlib
import json
import os
from pathlib import Path
import signal
import traceback

from offline_process import run_bounded

MAX_TRANSCRIPT = 16 * 1024 * 1024


def run_cli(command, *, cwd, env):
    """Bounded owner for vendor children and the production storage bridge."""
    return run_bounded(command, cwd=cwd, env=env, timeout=30,
                       max_output=4 * 1024 * 1024, cleanup_timeout=3)


class Capture:
    def __init__(self):
        value = os.environ.get("ORG2_NATIVE_TRANSCRIPT_OUTPUT")
        self.root = Path(value).resolve() if value else None
        self.cases = []
        self.handoffs = []
        self.native_resumes = 0
        self._homes = {}
        if self.root:
            self.root.mkdir(parents=True, exist_ok=True)

    def begin(self, name, session, transcript):
        case = {"name": name, "session": session, "baseline": f"{name}-before.jsonl", "snapshots": []}
        self.cases.append(case)
        self._copy(transcript, case["baseline"])
        return case

    def snapshot(self, case, transcript):
        name = f"{case['name']}-after-{len(case['snapshots']) + 1}.jsonl"
        self._copy(transcript, name)
        case["snapshots"].append(name)
        self.native_resumes += 1

    def handoff(self, case, transcript, home, cwd, env):
        """Publish through Rust storage into the other disposable native home."""
        executable = os.environ.get("ORG2_CLAUDE_STORAGE_BRIDGE_EXE")
        test_name = os.environ.get("ORG2_CLAUDE_STORAGE_BRIDGE_TEST")
        if not executable or not test_name:
            raise RuntimeError("production storage bridge is required for raw native acceptance")
        name = case["name"]
        if name not in self._homes:
            original = Path(home)
            other = original.with_name(original.name + "-handoff")
            other.mkdir()
            (other / ".claude").mkdir()
            # Independent fixture configuration: never clone source settings.
            (other / ".claude.json").write_text(json.dumps({"hasCompletedOnboarding": True}))
            (other / ".claude" / "settings.json").write_text("{}")
            relative = Path(transcript).relative_to(original)
            primary, package = original / relative, other / relative
            package.parent.mkdir(parents=True)
            self._homes[name] = (original, other, primary, package, original.parent / (name + "-handoff-state"))
        original, other, primary, package, state = self._homes[name]
        target_home = other if Path(home) == original else original
        target = package if Path(transcript) == primary else primary
        configs = [target_home / ".claude.json", target_home / ".claude" / "settings.json"]
        before_config = [path.read_bytes() for path in configs]
        before_raw = Path(transcript).read_bytes()
        result_path = state.with_suffix(".result.json")
        request_path = state.with_suffix(".request.json")
        request_path.write_text(json.dumps({"primary": str(primary), "package": str(package),
            "state": str(state), "cwd": str(cwd), "session": case["session"],
            "source": str(transcript), "destination": str(target), "result": str(result_path)}))
        result_path.unlink(missing_ok=True)
        bridge_env = dict(os.environ, ORG2_CLAUDE_HANDOFF_REQUEST=str(request_path))
        result = run_bounded([executable, "--exact", test_name, "--ignored", "--nocapture"],
            env=bridge_env, cwd=cwd, timeout=20, max_output=1024*1024, cleanup_timeout=3)
        if not result_path.is_file():
            raise RuntimeError("production storage bridge produced no receipt: " + result.stdout[-1500:])
        evidence = json.loads(result_path.read_text())
        if self.root:
            (self.root / f"{name}-handoff-{len(self.handoffs) + 1}.json").write_text(json.dumps(evidence, indent=2) + "\n")
        if any(type(evidence.get(field)) is not bool for field in ("published", "engineRejected", "rawBytesPreserved")):
            raise RuntimeError("production storage bridge receipt is missing required boolean evidence")
        if evidence.get("engineRejected") is True:
            raise AssertionError("production storage rejected native history: " + str(evidence.get("status")))
        if result.returncode != 0:
            raise RuntimeError("production storage bridge process failed: " + result.stdout[-1500:])
        assert evidence.get("published") is True, "production storage did not perform the required handoff"
        assert target.read_bytes() == before_raw
        assert [path.read_bytes() for path in configs] == before_config
        assert evidence["rawBytesPreserved"] is True and evidence["source"] == evidence["target"]
        evidence.update({"case": name, "targetConfigurationPreserved": True,
            "targetRawSha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        self.handoffs.append(evidence)
        next_env = dict(env, HOME=str(target_home), CLAUDE_CONFIG_DIR=str(target_home / ".claude"))
        return target, target_home, next_env

    def _copy(self, source, name):
        if not self.root:
            return
        with Path(source).open("rb") as handle:
            raw = handle.read(MAX_TRANSCRIPT + 1)
        if not raw or len(raw) > MAX_TRANSCRIPT:
            raise AssertionError("native transcript is empty or exceeds the canary byte limit")
        (self.root / name).write_bytes(raw)

    def run(self, action):
        status, detail = "pass", "native CLI fixture completed"
        previous = signal.getsignal(signal.SIGTERM)
        def cancelled(_signum, _frame):
            raise InterruptedError("fixture cancelled")
        signal.signal(signal.SIGTERM, cancelled)
        try:
            action()
        except AssertionError as error:
            status, detail = "incompatible", str(error)
        except Exception as error:
            status, detail = "infrastructure_error", f"{type(error).__name__}: {error}"
            traceback.print_exc()
        finally:
            signal.signal(signal.SIGTERM, previous)
        report = {"status": status, "detail": detail, "cases": self.cases,
                  "scope": "production_raw_storage_native_roundtrip", "nativeGuiTested": False,
                  "rawBytesPreserved": bool(self.handoffs) and all(item["rawBytesPreserved"] for item in self.handoffs),
                  "targetConfigurationPreserved": bool(self.handoffs) and all(item["targetConfigurationPreserved"] for item in self.handoffs),
                  "nativeHandoffs": len(self.handoffs), "nativeResumes": self.native_resumes, "handoffs": self.handoffs}
        if self.root:
            (self.root / "fixture-result.json").write_text(json.dumps(report, indent=2) + "\n")
        print("ORG2_CLAUDE_FIXTURE_RESULT=" + json.dumps(report), flush=True)
        return 0 if status == "pass" else (1 if status == "incompatible" else 2)
