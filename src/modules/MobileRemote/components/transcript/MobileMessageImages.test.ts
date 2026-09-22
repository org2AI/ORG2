// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MobileMessageImages,
  createImageRetention,
} from "./MobileMessageImages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/Button", () => ({
  default: ({
    children,
    variant: _variant,
    iconOnly: _iconOnly,
    shape: _shape,
    htmlType: _htmlType,
    icon: _icon,
    ...props
  }: React.ComponentProps<typeof import("@src/components/Button").default>) =>
    React.createElement("button", props, children),
}));
vi.mock("@src/scaffold/ModalSystem", () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: React.ReactNode;
    headerActions?: React.ReactNode;
  }) => React.createElement("div", { role: "dialog" }, headerActions, children),
}));

describe("MobileMessageImages", () => {
  it("bounds retained previews and releases unmounted entries", () => {
    const retention = createImageRetention();
    const first = vi.fn();
    retention.retain("first", first);
    for (let i = 0; i < 8; i += 1) retention.retain(String(i), vi.fn());
    expect(first).toHaveBeenCalledOnce();
    const disposed = vi.fn();
    retention.retain("removed", disposed)();
    for (let i = 10; i < 20; i += 1) retention.retain(String(i), vi.fn());
    expect(disposed).not.toHaveBeenCalled();
  });
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const url = "data:image/jpeg;base64,aGVsbG8=";
  it("loads only on demand, single-flights clicks, then opens a preview", async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    act(() =>
      root.render(
        React.createElement(MobileMessageImages, {
          eventId: "e",
          count: 1,
          loadImage: load,
        })
      )
    );
    expect(load).not.toHaveBeenCalled();
    act(() => {
      container.querySelector("button")!.click();
      container.querySelector("button")!.click();
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("images.loading");
    await act(async () => resolve(url));
    expect(container.querySelector("img")?.src).toBe(url);
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="common:actions.close"]'
        )!
        .click()
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("img")?.src).toBe(url);
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("supports failure followed by retry", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(url);
    act(() =>
      root.render(
        React.createElement(MobileMessageImages, {
          eventId: "e",
          count: 1,
          loadImage: load,
        })
      )
    );
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("images.retry");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("img")?.src).toBe(url);
  });
  it("discards late responses after changing desktop and does not retain its image", async () => {
    let resolve!: (value: string) => void;
    const oldLoad = () =>
      new Promise<string>((done) => {
        resolve = done;
      });
    act(() =>
      root.render(
        React.createElement(MobileMessageImages, {
          eventId: "e",
          count: 1,
          loadImage: oldLoad,
        })
      )
    );
    act(() => container.querySelector("button")!.click());
    act(() =>
      root.render(
        React.createElement(MobileMessageImages, { eventId: "e", count: 1 })
      )
    );
    await act(async () => resolve(url));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("button")!.disabled).toBe(true);
  });
  it("allows an already loaded preview offline and retries decode failures only after reconnect", async () => {
    const load = vi.fn().mockResolvedValue(url);
    const render = (available: boolean) =>
      act(() =>
        root.render(
          React.createElement(MobileMessageImages, {
            eventId: "e",
            count: 1,
            loadImage: available ? load : undefined,
          })
        )
      );
    render(true);
    await act(async () => container.querySelector("button")!.click());
    render(false);
    act(() => container.querySelector("button")!.click());
    expect(
      container.querySelector('[role="dialog"] img')?.getAttribute("src")
    ).toBe(url);
    act(() =>
      container.querySelector("img")!.dispatchEvent(new Event("error"))
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("button")!.disabled).toBe(true);
    render(true);
    expect(container.textContent).toContain("images.retry");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("retires interrupted requests and only accepts a fresh explicit request after reconnect", async () => {
    let resolve!: (value: string) => void;
    const oldLoad = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const render = (
      loadImage?: (eventId: string, index: number) => Promise<string>
    ) =>
      act(() =>
        root.render(
          React.createElement(MobileMessageImages, {
            eventId: "e",
            count: 1,
            loadImage,
          })
        )
      );
    render(oldLoad);
    act(() => container.querySelector("button")!.click());
    render();
    expect(container.querySelector("button")!.disabled).toBe(true);
    const restoredLoad = vi.fn().mockResolvedValue(url);
    render(restoredLoad);
    expect(restoredLoad).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click());
    await act(async () => resolve("data:image/jpeg;base64,b2xk"));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(restoredLoad).toHaveBeenCalledOnce();
  });
  it("has no requests or controls for a message without images", () => {
    act(() =>
      root.render(
        React.createElement(MobileMessageImages, { eventId: "e", count: 0 })
      )
    );
    expect(container.innerHTML).toBe("");
  });
});
