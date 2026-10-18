// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLoadedPayloads } from "@src/engines/SessionCore/payloads";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import BlockOutput from "./BlockOutput";

const ports = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { loadEventPayload: ports.read },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function deferred() {
  let resolve!: (value: { body: string } | null) => void;
  const promise = new Promise<{ body: string } | null>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let root: ReturnType<typeof createSmokeRoot>;
let onLoaded = vi.fn<(body: string) => void>();
function output(id: string) {
  return createElement(BlockOutput, {
    output: `preview-${id}`,
    sessionId: "session",
    eventId: id,
    payloadRef: {
      eventId: id,
      fieldPath: "result.content",
      preview: `preview-${id}`,
      fullSizeBytes: 200,
      truncated: true,
    },
    onFullPayloadLoaded: onLoaded,
  });
}
async function clickLoad() {
  const button = [...root.container.querySelectorAll("button")].find(
    (item) => item.textContent === "common:showMore"
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  clearLoadedPayloads();
  vi.resetAllMocks();
  onLoaded = vi.fn<(body: string) => void>();
  root = createSmokeRoot();
});
afterEach(async () => {
  await root.unmount();
  clearLoadedPayloads();
  vi.unstubAllGlobals();
});

describe("full output request lifecycle", () => {
  it("renders pending, full content and collapse through the actual control", async () => {
    const read = deferred();
    ports.read.mockReturnValue(read.promise);
    await root.render(output("a"));
    await clickLoad();
    expect(root.container.textContent).toContain("preview-a");
    expect(root.container.querySelector("button[disabled]")).not.toBeNull();
    await act(async () => read.resolve({ body: "full-a" }));
    expect(root.container.textContent).toContain("full-a");
    expect(onLoaded).toHaveBeenCalledWith("full-a");
    const collapse = [...root.container.querySelectorAll("button")].find(
      (item) => item.textContent === "common:showLess"
    );
    await act(async () => collapse!.click());
    expect(root.container.textContent).toContain("preview-a");
    expect(root.container.textContent).not.toContain("full-a");
  });
  it("does not publish old content or callback into new props, including A to B to A", async () => {
    const old = deferred();
    const fresh = deferred();
    ports.read
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    await root.render(output("a"));
    await clickLoad();
    await root.render(output("b"));
    // Same clear as a session departure; a reopened A must have a new owner.
    clearLoadedPayloads();
    await root.render(output("a"));
    await clickLoad();
    await act(async () => old.resolve({ body: "obsolete" }));
    expect(root.container.textContent).not.toContain("obsolete");
    expect(root.container.querySelector("button[disabled]")).not.toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
    await act(async () => fresh.resolve({ body: "fresh" }));
    expect(root.container.textContent).toContain("fresh");
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });
  it("keeps new scope readable while a different old request settles", async () => {
    const old = deferred();
    ports.read.mockReturnValue(old.promise);
    await root.render(output("a"));
    await clickLoad();
    await root.render(output("b"));
    await act(async () => old.resolve({ body: "old-a" }));
    expect(root.container.textContent).toContain("preview-b");
    expect(root.container.textContent).not.toContain("old-a");
    expect(onLoaded).not.toHaveBeenCalled();
  });
  it("does not deliver callbacks after unmount", async () => {
    const old = deferred();
    ports.read.mockReturnValue(old.promise);
    await root.render(output("a"));
    await clickLoad();
    await root.unmount();
    await act(async () => old.resolve({ body: "old" }));
    expect(onLoaded).not.toHaveBeenCalled();
  });
  it("shows errors and retries without an unhandled rejection", async () => {
    ports.read.mockRejectedValueOnce(new Error("Cannot read output"));
    await root.render(output("a"));
    await clickLoad();
    expect(
      root.container.querySelector('[role="alert"]')?.textContent
    ).toContain("Cannot read output");
    ports.read.mockResolvedValueOnce({ body: "recovered" });
    await clickLoad();
    expect(root.container.querySelector('[role="alert"]')).toBeNull();
    expect(root.container.textContent).toContain("recovered");
  });
  it("keeps an absent body retryable", async () => {
    ports.read.mockResolvedValueOnce(null);
    await root.render(output("a"));
    await clickLoad();
    expect(root.container.textContent).toContain("preview-a");
    ports.read.mockResolvedValueOnce({ body: "arrived" });
    await clickLoad();
    expect(root.container.textContent).toContain("arrived");
  });
});
