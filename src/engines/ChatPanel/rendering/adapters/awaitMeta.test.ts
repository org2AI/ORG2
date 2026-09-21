import { describe, expect, it } from "vitest";

import { resolveAwaitWaitedMs } from "./awaitMeta";

/** Args the Codex importer emits for a `write_stdin` poll. */
const codexPollArgs = {
  command: "wait_for",
  handle: "10689",
  handles: ["10689"],
  session_id: "10689",
  chars: "",
  block_until_ms: 1000,
};

const org2WaitArgs = {
  command: "wait_for",
  handles: ["48291"],
  block_until_ms: 600000,
};

function org2WaitResult(item: Record<string, unknown>) {
  return {
    output: [
      "[48291: succeeded]",
      `awaitMeta::${JSON.stringify({ count: 1, items: [item] })}`,
      "--- [48291] last 20 lines ---",
      "Wall time 7.0 seconds",
    ].join("\n"),
  };
}

describe("resolveAwaitWaitedMs", () => {
  it("reads a Codex Desktop poll's wall time from its script envelope", () => {
    const output =
      "Script completed\nWall time 5.0 seconds\nOutput:\n\n RUN  v4.1.11\n";

    expect(resolveAwaitWaitedMs(codexPollArgs, { output })).toBe(5000);
  });

  it("reads the unified exec envelope, not the process output below it", () => {
    const output = [
      "Chunk ID: 3f2a1b",
      "Wall time: 1.5 seconds",
      "Process running with session ID 10689",
      "Original token count: 12",
      "Output:",
      "bench Wall time: 99.0 seconds",
    ].join("\n");

    expect(resolveAwaitWaitedMs(codexPollArgs, { output })).toBe(1500);
  });

  it("falls back to the requested window when the envelope has no wall time", () => {
    const output = "Script completed\nOutput:\nWall time 99.0 seconds\n";

    expect(resolveAwaitWaitedMs(codexPollArgs, { output })).toBe(1000);
    expect(
      resolveAwaitWaitedMs(
        { command: "wait_for", duration_ms: 45000, block_until_ms: 45000 },
        { output: "Sleep completed." }
      )
    ).toBe(45000);
  });

  it("uses awaitMeta for ORG2 waits and never their requested window", () => {
    expect(
      resolveAwaitWaitedMs(
        org2WaitArgs,
        org2WaitResult({
          handle: "48291",
          jobKind: "shell",
          status: "running",
          waitedMs: 30000,
        })
      )
    ).toBe(30000);
    expect(
      resolveAwaitWaitedMs(
        org2WaitArgs,
        org2WaitResult({
          handle: "48291",
          jobKind: "shell",
          status: "succeeded",
          exitCode: 0,
        })
      )
    ).toBeUndefined();
  });

  it("reports nothing for an ORG2 wait cancelled before it produced awaitMeta", () => {
    expect(
      resolveAwaitWaitedMs(org2WaitArgs, {
        output: "await_output cancelled by turn boundary",
      })
    ).toBeUndefined();
  });
});
