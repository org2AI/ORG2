# Final-build restart regression — 2026-09-17 21:10–21:13Z

Build: this branch at `84330574d4311557bb9da884bab0626b7de8b233`, private debug
binary with the Instance 89 configuration (`pnpm exec tauri build --debug
--no-bundle --config /tmp/org2-package-native-instance89.json`), staged as an
immutable signed copy at
`~/.orgii-market-acceptance-20260917/staging/84330574d4/ORG2 Instance 89.app`
(sha256 in `binary-sha256.txt`). No installer or bundle was produced.

Procedure:
1. Snapshot (read-only) of the running `2a402f503b` instance: chat queue sha256,
   all 10 native Claude Code history files (sha256 + row counts), 20
   `sessions.db` table counts, external-home config hashes.
2. Normal quit of the old instance (menu Quit pressed twice had no effect while
   the window sat on another Space; a standard quit AppleEvent exited it in 2 s).
3. Start of the new stage through the existing launcher app under a clean
   environment (`env -i … open -a`): 0 inherited `ANTHROPIC_*`/`CLAUDECODE`
   variables in the new process, proxy listening on 17976 again.
4. Snapshot again.

Result: queue, all 10 history files, every table count and the external
Claude Code config are byte-identical before and after; the app opened signed
in as the same user with the previous sessions listed. Evidence files:
`evidence/final-delivery-before-restart-84330574d.json`,
`evidence/final-delivery-after-restart-84330574d.json` under the acceptance root.

Note for the launch procedure: a second launch while the old instance is
still running is forwarded to it by the single-instance guard
(`external open request forwarded to the running app`), so the old process
must actually be gone before starting the new stage.
