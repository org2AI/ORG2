import { beforeEach, describe, expect, it, vi } from "vitest";

import { postLoadCliSession } from "../cliHistory";

const mocks = vi.hoisted(() => ({ status: vi.fn(), usage: vi.fn() }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cli: { status: mocks.status } },
}));
vi.mock("@src/api/tauri/session/contextUsage", () => ({
  cliSessionContextUsage: mocks.usage,
}));
vi.mock("@src/engines/SessionCore/ingestion/rustBridge", () => ({
  processChunksRust: vi.fn(),
}));

describe("CLI context hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue({
      status: "completed",
      totalTokens: 999999,
      transcriptSource: "native",
    });
  });
  it("uses native telemetry instead of cumulative billing", async () => {
    const usage = {
      usedTokens: 110,
      maxTokens: null,
      sections: [],
      warnings: [],
      updatedAt: "now",
    };
    mocks.usage.mockResolvedValue(usage);
    expect(
      await postLoadCliSession("cliagent-a", new AbortController().signal)
    ).toMatchObject({ contextTokens: 110, contextUsage: usage });
  });
  it("does not fall back to billing when context is unavailable", async () => {
    mocks.usage.mockResolvedValue(null);
    expect(
      await postLoadCliSession("cliagent-a", new AbortController().signal)
    ).toMatchObject({ contextTokens: 0, contextUsage: null });
  });
  it("preserves usable session status when optional telemetry fails", async () => {
    mocks.usage.mockRejectedValue(new Error("missing source"));
    expect(
      await postLoadCliSession("cliagent-a", new AbortController().signal)
    ).toMatchObject({
      runStatus: "completed",
      contextTokens: 0,
      contextUsage: null,
    });
  });
});
