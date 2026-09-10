import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeNativeCliCommand } from "../executeNativeCliCommand";

const mocks = vi.hoisted(() => ({ phase: vi.fn(), dispatch: vi.fn() }));
vi.mock("@src/engines/SessionCore/control/turnLifecycle", () => ({
  getTurnPhase: mocks.phase,
}));
vi.mock("@src/engines/SessionCore/services/userIntentDispatch", () => ({
  dispatchUserIntent: mocks.dispatch,
}));

describe("native protocol command dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase.mockReturnValue("idle");
    mocks.dispatch.mockResolvedValue({});
  });
  it("uses the existing intent transport without waiting for a provider user echo", async () => {
    await executeNativeCliCommand("cliagent-c", "/compact");
    expect(mocks.dispatch).toHaveBeenCalledWith({
      sessionId: "cliagent-c",
      visibleText: "/compact",
      send: {
        content: "/compact",
        turnIntentId: expect.any(String),
        turnIntentSource: "user_submit",
      },
    });
  });
  it.each(["dispatching", "working", "stopping"])(
    "rejects %s before sending",
    async (phase) => {
      mocks.phase.mockReturnValue(phase);
      await expect(
        executeNativeCliCommand("cliagent-c", "/review")
      ).rejects.toThrow("Wait for");
      expect(mocks.dispatch).not.toHaveBeenCalled();
    }
  );
  it("propagates transport rejection so the composer retains its draft", async () => {
    mocks.dispatch.mockRejectedValue(new Error("busy"));
    await expect(
      executeNativeCliCommand("cliagent-c", "/init")
    ).rejects.toThrow("busy");
  });
});
