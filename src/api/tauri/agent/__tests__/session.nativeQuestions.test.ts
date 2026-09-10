import { beforeEach, describe, expect, it, vi } from "vitest";

import { rejectQuestion, respondQuestion } from "../session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  respond: vi.fn(),
  reject: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    agentSession: {
      respondQuestion: mocks.respond,
      rejectQuestion: mocks.reject,
    },
  },
}));

beforeEach(() => vi.resetAllMocks());

describe("native question routing", () => {
  it("routes a provider tool id through the live CLI registry", async () => {
    mocks.invoke.mockResolvedValue(true);
    await respondQuestion("cliagent-native", "toolu-original", [["Beta"]]);
    expect(mocks.invoke).toHaveBeenCalledWith("cli_native_question_response", {
      sessionId: "cliagent-native",
      requestId: "toolu-original",
      answers: [["Beta"]],
    });
    expect(mocks.respond).not.toHaveBeenCalled();
  });
  it("does not report a rejected native response as legacy success", async () => {
    mocks.invoke.mockRejectedValue(new Error("Native interaction expired"));
    await expect(
      respondQuestion("cliagent-native", "toolu-old", [["Beta"]])
    ).rejects.toThrow("expired");
    expect(mocks.respond).not.toHaveBeenCalled();
  });
  it("preserves the existing transport for other CLI adapters", async () => {
    mocks.invoke.mockResolvedValue(false);
    await respondQuestion("cliagent-other", "question", [["Yes"]]);
    expect(mocks.respond).toHaveBeenCalledWith({
      sessionId: "cliagent-other",
      requestId: "question",
      answers: [["Yes"]],
    });
  });
  it("keeps the native ORG2 harness on its own transport", async () => {
    await rejectQuestion("sdeagent-native", "question");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.reject).toHaveBeenCalled();
  });
});
