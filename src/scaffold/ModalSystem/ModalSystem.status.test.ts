// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Modal from "./index";

describe("Modal action status", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it.each([
    ["danger", "bg-danger-6"],
    ["warning", "bg-warning-6"],
    ["success", "bg-success-6"],
    ["default", "bg-primary-6"],
    [undefined, "bg-primary-6"],
  ] as const)(
    "renders the requested %s status on the actual action",
    (status, color) => {
      const onOk = vi.fn();
      act(() =>
        root.render(
          createElement(Modal, {
            visible: true,
            title: "Confirm",
            onOk,
            okButtonProps: { status, loading: false },
          })
        )
      );
      const primary = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === "OK")!;
      expect(primary.classList.contains(color)).toBe(true);
      act(() => primary.click());
      expect(onOk).toHaveBeenCalledOnce();
    }
  );
});
