import { afterEach, describe, expect, it, vi } from "vitest";

import { invokeTauri } from "@src/util/platform/tauri/init";

import { getAgentOrgHistoryDescriptor } from "./history";

vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: vi.fn() }));
const invoke = vi.mocked(invokeTauri);

afterEach(() => vi.clearAllMocks());

describe("history descriptor request ownership", () => {
  it("shares pending lookups but drops completed results", async () => {
    let resolve!: (value: null) => void;
    invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const first = getAgentOrgHistoryDescriptor("session");
    expect(getAgentOrgHistoryDescriptor("session")).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve(null);
    await first;
    invoke.mockResolvedValue(null);
    await getAgentOrgHistoryDescriptor("session");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("allows explicit retry after failure", async () => {
    invoke.mockRejectedValueOnce(new Error("offline"));
    await expect(getAgentOrgHistoryDescriptor("retry")).rejects.toThrow(
      "offline"
    );
    invoke.mockResolvedValueOnce(null);
    await expect(getAgentOrgHistoryDescriptor("retry")).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("bounds retained pending identities without blocking new lookups", async () => {
    const resolvers: ((value: null) => void)[] = [];
    invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolvers.push(done);
        })
    );
    const requests = Array.from({ length: 128 }, (_, index) =>
      getAgentOrgHistoryDescriptor(`session-${index}`)
    );
    expect(getAgentOrgHistoryDescriptor("session-0")).toBe(requests[0]);
    const overflow = getAgentOrgHistoryDescriptor("overflow");
    const overflowAgain = getAgentOrgHistoryDescriptor("overflow");
    expect(overflow).not.toBe(overflowAgain);
    expect(invoke).toHaveBeenCalledTimes(130);
    resolvers.forEach((resolve) => resolve(null));
    await Promise.all([...requests, overflow, overflowAgain]);
  });
});
