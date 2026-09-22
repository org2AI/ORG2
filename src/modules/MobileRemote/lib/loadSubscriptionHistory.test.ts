import { describe, expect, it, vi } from "vitest";

import { loadSubscriptionHistory } from "./loadSubscriptionHistory";
import {
  type TranscriptSubscribeResult,
  applyTranscriptSubscribeResult,
  beginTranscriptLoad,
  createInitialTranscriptLoadState,
  getSelectedTranscriptView,
} from "./transcriptLoadState";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function result(partial = true): TranscriptSubscribeResult {
  return {
    sessionId: "s",
    historyDeferred: partial,
    rounds: {
      items: (partial ? ["r2"] : ["r1", "r2"]).map((id) => ({ id })),
      complete: !partial,
    },
    snapshot: {
      sessionId: "s",
      roundId: "r2",
      version: 1,
      snapshotDelta: false,
      upserts: [
        {
          id: "answer",
          source: "assistant",
          displayVariant: "message",
          displayText: "Latest answer",
        },
      ],
    },
  };
}

describe("progressive subscription history", () => {
  it("opens an owner and hydrates its directory with one initial RPC", async () => {
    const first = {
      ...result(),
      sessionId: "owner",
      managed: true,
      subscriptionId: "lease",
      snapshot: { ...result().snapshot, sessionId: "owner" },
    };
    const call = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, historyDeferred: false });
    const identity = vi.fn();
    const apply = vi.fn();
    await loadSubscriptionHistory({ call }, "mirror", () => true, apply, true, {
      subscriptionId: "lease",
      onIdentity: identity,
    });
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "session/open",
      "session/history",
    ]);
    expect(call.mock.calls[1][1]).toEqual({ sessionId: "owner" });
    expect(identity).toHaveBeenCalledWith("owner", true);
    expect(apply).toHaveBeenCalledWith(first);
  });

  it("rejects a mismatched opening before publishing identity or body", async () => {
    const identity = vi.fn();
    const apply = vi.fn();
    const call = vi.fn().mockResolvedValue({
      ...result(),
      managed: false,
      subscriptionId: "wrong",
    });
    await expect(
      loadSubscriptionHistory({ call }, "s", () => true, apply, true, {
        subscriptionId: "expected",
        onIdentity: identity,
      })
    ).rejects.toThrow("Invalid session opening");
    expect(identity).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("shares in-flight directory reads and releases them after completion", async () => {
    const directory = deferred<TranscriptSubscribeResult>();
    const call = vi
      .fn()
      .mockImplementation((method: string) =>
        method === "session/history"
          ? directory.promise
          : Promise.resolve(result())
      );
    const client = { call };
    await loadSubscriptionHistory(client, "s", () => true, vi.fn());
    await loadSubscriptionHistory(client, "s", () => true, vi.fn());
    expect(
      call.mock.calls.filter(([method]) => method === "session/history")
    ).toHaveLength(1);
    directory.resolve(result(false));
    await directory.promise;
    await loadSubscriptionHistory(client, "s", () => true, vi.fn());
    expect(
      call.mock.calls.filter(([method]) => method === "session/history")
    ).toHaveLength(2);
  });

  it("bounds pending directory reads per connection", async () => {
    const directory = deferred<TranscriptSubscribeResult>();
    const call = vi
      .fn()
      .mockImplementation((method: string) =>
        method === "session/history"
          ? directory.promise
          : Promise.resolve(result())
      );
    const client = { call };
    for (let i = 0; i < 12; i++) {
      await loadSubscriptionHistory(client, String(i), () => true, vi.fn());
    }
    expect(
      call.mock.calls.filter(([method]) => method === "session/history")
    ).toHaveLength(8);
    directory.reject(new Error("connection closed"));
    await Promise.resolve();
    await Promise.resolve();
    await loadSubscriptionHistory(client, "another", () => true, vi.fn());
    expect(
      call.mock.calls.filter(([method]) => method === "session/history")
    ).toHaveLength(9);
  });
  it("makes the latest body ready before the directory RPC resolves", async () => {
    const directory = deferred<TranscriptSubscribeResult>();
    const call = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockReturnValueOnce(directory.promise);
    let state = beginTranscriptLoad(createInitialTranscriptLoadState(), "s", 1);
    const apply = (r: TranscriptSubscribeResult) => {
      state = applyTranscriptSubscribeResult(state, r, "s", 1);
    };
    expect(
      await loadSubscriptionHistory({ call }, "s", () => true, apply)
    ).toBe(true);
    expect(getSelectedTranscriptView(state).phase).toBe("ready");
    expect(getSelectedTranscriptView(state).items).toHaveLength(1);
    expect(state.roundsComplete).toBe(false);
    directory.resolve(result(false));
    await directory.promise;
    await Promise.resolve();
    expect(state.roundsComplete).toBe(true);
    expect(state.rounds.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(getSelectedTranscriptView(state).items).toHaveLength(1);
    expect(call.mock.calls).toEqual([
      ["session/subscribe", { sessionId: "s", latestOnly: true }],
      ["session/history", { sessionId: "s" }],
    ]);
  });

  it("keeps the first body on directory timeout, and retries on reopening", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(false));
    const apply = vi.fn();
    await loadSubscriptionHistory({ call }, "s", () => true, apply);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    await loadSubscriptionHistory({ call }, "s", () => true, apply);
    await Promise.resolve();
    expect(apply).toHaveBeenLastCalledWith(result(false));
  });

  it("does not hydrate or start directory work after a stale initial response", async () => {
    const call = vi.fn().mockResolvedValue(result());
    const apply = vi.fn();
    expect(
      await loadSubscriptionHistory({ call }, "s", () => false, apply)
    ).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("ignores directory completion after connection/session/generation replacement", async () => {
    const directory = deferred<TranscriptSubscribeResult>();
    let current = true;
    const call = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockReturnValueOnce(directory.promise);
    const apply = vi.fn();
    await loadSubscriptionHistory({ call }, "s", () => current, apply);
    current = false;
    directory.resolve(result(false));
    await directory.promise;
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("preserves first-request errors for the existing retry/error UI", async () => {
    const call = vi.fn().mockRejectedValue(new Error("offline"));
    const apply = vi.fn();
    await expect(
      loadSubscriptionHistory({ call }, "s", () => true, apply)
    ).rejects.toThrow("offline");
    expect(apply).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not request another history on old servers or empty full responses", async () => {
    const legacy = { sessionId: "s", rounds: { items: [], complete: true } };
    const call = vi.fn().mockResolvedValue(legacy);
    const apply = vi.fn();
    await loadSubscriptionHistory({ call }, "s", () => true, apply);
    expect(call).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(legacy);
  });
});
