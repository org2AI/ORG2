// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useColumnResize } from "./useColumnResize";

it("resizes from the CSS-constrained width after a viewport shrink", () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const commit = vi.fn();
  function Pane() {
    const { columnRef, handleMouseDown } = useColumnResize({
      width: 420,
      setWidth: commit,
      min: 200,
      max: 720,
      inverted: true,
    });
    return React.createElement("div", {
      ref: columnRef,
      onMouseDown: handleMouseDown,
      style: { width: 420, maxWidth: "50%" },
    });
  }
  try {
    act(() => root.render(React.createElement(Pane)));
    const column = host.firstElementChild as HTMLDivElement;
    Object.defineProperty(column, "offsetWidth", { value: 300 });
    act(() =>
      column.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 300, button: 0 })
      )
    );
    act(() =>
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 320, buttons: 1 })
      )
    );
    act(() =>
      window.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 320 })
      )
    );
    expect(commit).toHaveBeenCalledWith(280);
  } finally {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
