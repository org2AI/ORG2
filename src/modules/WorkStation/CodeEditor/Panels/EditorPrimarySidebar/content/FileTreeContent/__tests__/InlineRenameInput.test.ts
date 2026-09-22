// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { InlineRenameInput } from "../InlineRenameInput";

it("keeps native focus, filename selection, F2 cycling and submission through shared Input", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn(),
    onCancel = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(InlineRenameInput, {
          initialName: "notes.txt",
          isDirectory: false,
          onConfirm,
          onCancel,
        })
      )
    );
    const input = host.querySelector("input")!;
    expect(input.closest(".input-field-bare")).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F2",
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "renamed.txt");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith("renamed.txt");
    expect(onCancel).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
