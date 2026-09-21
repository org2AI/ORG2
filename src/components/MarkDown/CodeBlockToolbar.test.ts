// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { CodeBlockToolbar } from "./CodeBlockToolbar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared code block toolbar", () => {
  it("preserves Desktop copy/open actions while touch mode gates pending copy", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCopy = vi.fn();
    const onOpen = vi.fn();
    try {
      await act(async () =>
        root.render(
          React.createElement(CodeBlockToolbar, {
            copyLabel: "Copy",
            copied: false,
            onCopy,
            openLabel: "Open",
            onOpen,
          })
        )
      );
      await act(async () => {
        (
          host.querySelector('[aria-label="Open"]') as HTMLButtonElement
        ).click();
        (
          host.querySelector('[aria-label="Copy"]') as HTMLButtonElement
        ).click();
      });
      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[data-touch]")).toBeNull();
      await act(async () =>
        root.render(
          React.createElement(CodeBlockToolbar, {
            touch: true,
            pending: true,
            copyLabel: "Copying",
            copied: false,
            onCopy,
          })
        )
      );
      expect(host.querySelector("[data-touch]")).not.toBeNull();
      expect(host.querySelector('[aria-label="Open"]')).toBeNull();
      await act(async () =>
        (host.querySelector("button") as HTMLButtonElement).click()
      );
      expect(onCopy).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
