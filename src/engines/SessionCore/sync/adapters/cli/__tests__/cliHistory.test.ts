import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadCliHistory,
  loadCliPreviewHistory,
  loadCliTranscriptRevision,
} from "../cliHistory";

const mocks = vi.hoisted(() => ({
  transcriptRevision: vi.fn(),
  history: vi.fn(),
}));

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    cli: {
      transcriptRevision: mocks.transcriptRevision,
      history: mocks.history,
    },
  },
}));

describe("loadCliTranscriptRevision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the legacy, unavailable, and stable native revision states", async () => {
    mocks.transcriptRevision.mockResolvedValueOnce({
      native: false,
      revision: null,
    });
    await expect(loadCliTranscriptRevision("legacy")).resolves.toBeUndefined();

    mocks.transcriptRevision.mockResolvedValueOnce({
      native: true,
      revision: null,
    });
    await expect(loadCliTranscriptRevision("unavailable")).resolves.toBeNull();

    mocks.transcriptRevision.mockResolvedValueOnce({
      native: true,
      revision: "native-file-v1:123:456",
    });
    await expect(loadCliTranscriptRevision("stable")).resolves.toBe(
      "native-file-v1:123:456"
    );
  });
});

describe("managed CLI history read ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transcriptRevision.mockResolvedValue({
      native: true,
      revision: "account-a:v1",
    });
  });

  it("reads independently when the optional coalescing probe fails", async () => {
    mocks.transcriptRevision.mockRejectedValue(new Error("stat failed"));
    mocks.history.mockResolvedValue([]);
    const signal = new AbortController().signal;
    await expect(
      Promise.all([
        loadCliPreviewHistory("cliagent-probe-failed", signal),
        loadCliPreviewHistory("cliagent-probe-failed", signal),
      ])
    ).resolves.toEqual([[], []]);
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it("shares concurrent previews, separates canonical reads and releases completed bodies", async () => {
    let finish!: (events: []) => void;
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        })
    );
    const signal = new AbortController().signal;
    const first = loadCliPreviewHistory("cliagent-shared", signal);
    const second = loadCliPreviewHistory("cliagent-shared", signal);
    await vi.waitFor(() => expect(mocks.history).toHaveBeenCalledOnce());
    finish([]);
    await Promise.all([first, second]);
    mocks.history.mockResolvedValue([]);
    await loadCliPreviewHistory("cliagent-shared", signal);
    await loadCliHistory("cliagent-shared", signal);
    expect(mocks.history).toHaveBeenCalledTimes(3);
    expect(mocks.history).toHaveBeenLastCalledWith({
      sessionId: "cliagent-shared",
      read: { kind: "full" },
    });
  });

  it("does not join another account binding or cancel another reader", async () => {
    let finish!: (events: []) => void;
    mocks.history.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        })
    );
    const controller = new AbortController();
    const first = loadCliPreviewHistory("cliagent-switch", controller.signal);
    await vi.waitFor(() => expect(mocks.history).toHaveBeenCalledOnce());
    mocks.transcriptRevision.mockResolvedValue({
      native: true,
      revision: "account-b:v1",
    });
    mocks.history.mockResolvedValue([]);
    await loadCliPreviewHistory(
      "cliagent-switch",
      new AbortController().signal
    );
    expect(mocks.history).toHaveBeenCalledTimes(2);
    controller.abort();
    finish([]);
    await expect(first).resolves.toEqual([]);
  });

  it("releases rejected reads for retry", async () => {
    mocks.history
      .mockRejectedValueOnce(new Error("unreadable"))
      .mockResolvedValue([]);
    const signal = new AbortController().signal;
    await expect(
      loadCliPreviewHistory("cliagent-retry", signal)
    ).rejects.toThrow("unreadable");
    await expect(
      loadCliPreviewHistory("cliagent-retry", signal)
    ).resolves.toEqual([]);
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });
});
