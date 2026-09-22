const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test(
  "frontend-title cleanup excludes the renamed native dev executable",
  { skip: process.platform === "win32" },
  () => {
    const sandbox = fs.mkdtempSync(
      path.join(os.tmpdir(), "orgii-cleanup-name-")
    );
    const log = path.join(sandbox, "killed.log");
    const stub = (name, body) =>
      fs.writeFileSync(path.join(sandbox, name), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
      });
    try {
      // Execute the real cleanup script against fake process enumeration and
      // kill commands. No test command can signal an actual user process.
      for (const name of ["ps", "lsof", "sleep"]) stub(name, "exit 0");
      const match = `for command in 'ORG2 Dev' '/tmp/debug/ORG2 Dev'; do
  if printf '%s\\n' "$command" | /usr/bin/grep -Eq "$2"; then
    if [ "$(basename "$0")" = pkill ]; then
      printf '%s\\n' "$command" >> "$ORGII_CLEANUP_TEST_LOG"
    else
      printf '123\\n'
    fi
  fi
done`;
      stub("pgrep", match);
      stub("pkill", match);
      execFileSync(
        "/bin/sh",
        [path.join(__dirname, "cleanup-orphans.sh"), "--quiet"],
        {
          env: {
            ...process.env,
            PATH: `${sandbox}:/usr/bin:/bin`,
            ORGII_CLEANUP_TEST_LOG: log,
          },
        }
      );
      assert.equal(fs.readFileSync(log, "utf8"), "ORG2 Dev\n");
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
);
