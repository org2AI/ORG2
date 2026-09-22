// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileComposerAttachmentButton } from "./MobileComposerAttachmentButton";
import { MobileComposerImagePreview } from "./MobileComposerImagePreview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("uses shared attachment Button and preserves busy/disabled gating and native file selection", async () => {
  const onFilesSelected = vi.fn();
  const render = async (busy = false, disabled = false) =>
    act(async () =>
      root.render(
        React.createElement(MobileComposerAttachmentButton, {
          busy,
          disabled,
          onFilesSelected,
        })
      )
    );
  await render();
  const input = host.querySelector("input")!;
  const open = vi.spyOn(input, "click");
  const button = host.querySelector("button")!;
  expect(button.classList.contains("button")).toBe(true);
  expect(button.querySelector('[data-icon="plus"]')).not.toBeNull();
  await act(async () => button.click());
  expect(open).toHaveBeenCalledOnce();
  await render(true);
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  await render(false, true);
  await act(async () => button.click());
  expect(open).toHaveBeenCalledOnce();
  await render();
  const file = new File(["image"], "photo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  expect(onFilesSelected).toHaveBeenCalledWith([file]);
  Object.defineProperty(input, "files", { value: [] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  expect(onFilesSelected).toHaveBeenCalledOnce();
});

it("uses shared removal buttons with a larger hit target and removes only the selected draft image", async () => {
  const onRemove = vi.fn();
  const parentClick = vi.fn();
  const images = ["one", "two"].map((id) => ({
    id,
    fileName: `${id}.png`,
    dataUrl: "data:image/png;base64,AA==",
  }));
  await act(async () =>
    root.render(
      React.createElement(
        "div",
        { onClick: parentClick },
        React.createElement(MobileComposerImagePreview, { images, onRemove })
      )
    )
  );
  const buttons = host.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[1].classList.contains("button")).toBe(true);
  expect(buttons[1].querySelector('[data-icon="x"]')).not.toBeNull();
  expect(buttons[1].classList.contains("min-h-11")).toBe(true);
  expect(buttons[1].getAttribute("aria-label")).toBe("actions.remove: two.png");
  await act(async () => buttons[1].click());
  expect(onRemove).toHaveBeenCalledOnce();
  expect(onRemove).toHaveBeenCalledWith("two");
  expect(parentClick).not.toHaveBeenCalled();
  expect(images).toHaveLength(2);
});
