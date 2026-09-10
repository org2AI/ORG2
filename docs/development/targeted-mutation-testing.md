# Targeted mutation testing

Run `pnpm test:mutation` to test the tests for `shouldInterruptTimelineBoundary`.
The helper decides whether stop, force-send or rewind should interrupt a target
session. The existing three tests cover idle rewind, active-turn rewind,
live-subagent rewind and unconditional stop/force-send interruption.

The initial run killed all nine generated mutants with no survivors, uncovered
mutants, timeouts or errors. CI requires a 100% score for this small decision
surface. Do not lower the threshold to accommodate a regression; inspect the
JSON report under `node_modules/.cache/stryker/report.json` and strengthen the
behavioral test where needed. There are no excluded mutation operators.

This is deliberately one pure decision helper, not coverage of the whole FSM or
all hooks. The dedicated Vitest configuration uses the real production helper
and existing tests without application setup or mocks. A single Stryker worker
and a single Vitest thread bound resource use. The sandbox copies only four
explicit files, and reports and temporary files stay under ignored node_modules.
The workflow runs on changes to its source, test, configuration or dependencies,
and can be triggered manually; its timeout is ten minutes.

The two Stryker packages are pinned at 8.7.1, compatible with the existing Vitest
2.1.9 and CI Node 20. They are development-only dependencies. Existing lockfile
resolutions are preserved. Revert the configuration, workflow, package entries
and lockfile additions to roll back. Expanding the mutation scope should be a
separate measured change with reviewed runtime and mutation results.

Configuration follows the [official Vitest runner documentation](https://stryker-mutator.io/docs/stryker-js/vitest-runner/).
