// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { listenForDrag } from "./dragLifecycle";

let dispose = () => {};
afterEach(() => {
  dispose();
  vi.restoreAllMocks();
});
function event(type: string, buttons = 1, pointerId = 7) {
  const value = new MouseEvent(type, { bubbles: true, buttons });
  Object.defineProperty(value, "pointerId", { value: pointerId });
  return value;
}
it.each(["blur", "hidden", "pointercancel", "released-move"])(
  "terminates once on %s before later movement",
  (reason) => {
    const onMove = vi.fn();
    const onCancel = vi.fn();
    const onEnd = vi.fn();
    dispose = listenForDrag({ onMove, onCancel, onEnd });
    window.dispatchEvent(event("mousemove"));
    if (reason === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    } else
      window.dispatchEvent(
        reason === "released-move" ? event("mousemove", 0) : event(reason)
      );
    window.dispatchEvent(event("mousemove"));
    window.dispatchEvent(event("mouseup", 0));
    window.dispatchEvent(new Event("blur"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  }
);
it("ignores foreign pointers and catches a stopped release for the owning pointer", () => {
  const onMove = vi.fn();
  const onCancel = vi.fn();
  const onEnd = vi.fn();
  dispose = listenForDrag({ pointerId: 7, onMove, onCancel, onEnd });
  window.dispatchEvent(event("pointermove", 1, 8));
  window.dispatchEvent(event("pointercancel", 0, 8));
  window.dispatchEvent(event("pointerup", 0, 8));
  expect(onMove).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  const node = document.createElement("div");
  document.body.appendChild(node);
  node.addEventListener("pointerup", (e) => e.stopPropagation());
  node.dispatchEvent(event("pointermove"));
  node.dispatchEvent(event("pointerup", 0));
  window.dispatchEvent(event("pointermove"));
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  node.remove();
});
it("detaches every registration on disposal without callbacks or timers", () => {
  const addWindow = vi.spyOn(window, "addEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  const addDocument = vi.spyOn(document, "addEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const timer = vi.spyOn(window, "setTimeout");
  const onCancel = vi.fn();
  const onEnd = vi.fn();
  for (let i = 0; i < 3; i++) {
    dispose = listenForDrag({ onMove: vi.fn(), onCancel, onEnd });
    dispose();
    dispose();
  }
  expect(removeWindow.mock.calls).toEqual(addWindow.mock.calls);
  expect(removeDocument.mock.calls).toEqual(addDocument.mock.calls);
  expect(onCancel).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
});
