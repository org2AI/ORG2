// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SpotlightSearchBar } from "./SpotlightSearchBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/AnyIcon", () => ({ default: () => null }));
vi.mock("@src/components/Button", () => ({ default: () => null }));
vi.mock("@src/components/KeyboardShortcut/ToolbarTooltip", () => ({
  ToolbarTooltip: () => null,
}));

let root: Root;
let container: HTMLDivElement;
let input: HTMLInputElement;
const navigate = vi.fn();
const writeQuery = vi.fn();

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(SpotlightSearchBar, {
        inputRef: createRef<HTMLInputElement>(),
        searchQuery: "asdf",
        onSearchQueryChange: writeQuery,
        onKeyDown: navigate,
        placeholder: "Search",
        path: [],
      })
    )
  );
  input = container.querySelector("input")!;
  input.focus();
  input.setSelectionRange(2, 2);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => input.dispatchEvent(event));
  return event;
}
it.each(["ArrowLeft", "ArrowRight", "\uF702", "\uF703"])(
  "consumes %s before navigation or native insertion",
  (key) => {
    expect(press(key).defaultPrevented).toBe(true);
    expect(input.selectionStart).toBe(
      key === "ArrowLeft" || key === "\uF702" ? 1 : 3
    );
    expect(input.value).toBe("asdf");
    expect(writeQuery).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  }
);
it("extends, shrinks, and collapses selections", () => {
  press("ArrowLeft", { shiftKey: true });
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([1, 2, "backward"]);
  press("ArrowRight", { shiftKey: true });
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  input.setSelectionRange(1, 3);
  press("ArrowLeft");
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 1]);
});
it("supports word and whole-query navigation", () => {
  input.value = "hello world";
  input.setSelectionRange(11, 11);
  press("ArrowLeft", { altKey: true });
  expect(input.selectionStart).toBe(6);
  press("ArrowLeft", { ctrlKey: true });
  expect(input.selectionStart).toBe(0);
  press("ArrowRight", { metaKey: true, shiftKey: true });
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 11]);
});
it("moves across whole graphemes and clamps at boundaries", () => {
  input.value = "a👩‍💻e\u0301";
  input.setSelectionRange(1, 1);
  press("ArrowRight");
  expect(input.selectionStart).toBe(6);
  press("ArrowRight");
  press("ArrowRight");
  expect(input.selectionStart).toBe(8);
  input.value = "";
  press("ArrowLeft");
  expect(input.selectionStart).toBe(0);
});
it("leaves composition to the IME and delegates other keys", () => {
  expect(press("ArrowLeft", { isComposing: true }).defaultPrevented).toBe(
    false
  );
  expect(navigate).not.toHaveBeenCalled();
  press("Enter");
  expect(navigate).toHaveBeenCalledOnce();
});
