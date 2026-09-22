import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeTauri } from "@src/util/platform/tauri/init";

import { loadRustAgentPostLoadResult } from "../postLoad";

vi.mock("@src/api/tauri/agent", () => ({
  getSession: vi.fn().mockResolvedValue({ status: "completed" }),
  getSessionInfo: vi.fn(),
}));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {},
}));
vi.mock("../toolUsageCache", () => ({
  applyLlmUsageToEvents: vi.fn(),
  applyToolUsageToEvents: vi.fn(),
  loadUsageTelemetry: vi.fn(),
}));

const load = () =>
  loadRustAgentPostLoadResult("parent", new AbortController().signal, {
    category: "sde",
    tokenUsageCommand: "get_session_token_usage",
  });

describe("postLoad auxiliary usage", () => {
  beforeEach(() => vi.mocked(invokeTauri).mockReset());

  it("keeps the main context after later title and memory receipts", async () => {
    vi.mocked(invokeTauri).mockResolvedValue([
      {
        inputTokens: 10,
        contextTokens: 32000,
        contextUsageJson: '{"usedTokens":32000}',
      },
      { inputTokens: 777, contextTokens: 0, usagePurpose: "session_title" },
      {
        inputTokens: 2,
        contextTokens: 0,
        usagePurpose: "workspace_memory",
        contextUsageJson: '{"usedTokens":2}',
      },
    ]);
    const result = await load();
    expect(result.contextTokens).toBe(32000);
    expect(result.contextUsage?.usedTokens).toBe(32000);
  });

  it("does not invent main context when only auxiliary receipts exist", async () => {
    vi.mocked(invokeTauri).mockResolvedValue([
      { inputTokens: 777, contextTokens: 0, usagePurpose: "session_title" },
    ]);
    const result = await load();
    expect(result.contextTokens).toBeUndefined();
    expect(result.contextUsage).toBeUndefined();
  });

  it("retains legacy input fallback when purpose and snapshot are absent", async () => {
    vi.mocked(invokeTauri).mockResolvedValue([
      { inputTokens: 4321, contextTokens: 0 },
      { inputTokens: 777, contextTokens: 0, usagePurpose: "session_title" },
    ]);
    expect((await load()).contextTokens).toBe(4321);
  });

  it("keeps the latest main compaction context after trailing auxiliary work", async () => {
    vi.mocked(invokeTauri).mockResolvedValue([
      { inputTokens: 10000, contextTokens: 32000 },
      { inputTokens: 1, contextTokens: 0, usagePurpose: "compaction" },
      {
        inputTokens: 0,
        contextTokens: 4000,
        contextUsageJson: '{"usedTokens":4000}',
      },
      { inputTokens: 2, contextTokens: 0, usagePurpose: "workspace_memory" },
    ]);
    expect((await load()).contextTokens).toBe(4000);
  });
});
