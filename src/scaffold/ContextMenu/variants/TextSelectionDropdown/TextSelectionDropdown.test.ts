// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TextSelectionDropdown from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai");
  return { recentSessionsAtom: atom([]) };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function render(props: Record<string, unknown>) {
  act(() => {
    root.render(
      createElement(TextSelectionDropdown, {
        visible: true,
        position: { x: 40, y: 120 },
        selectedText: "the passage",
        onClose: () => {},
        ...props,
      } as never)
    );
  });
}

function actionLabels(): string[] {
  return [...document.querySelectorAll('[role="button"]')].map(
    (node) => node.textContent ?? ""
  );
}

describe("TextSelectionDropdown inline layout", () => {
  it("offers pin and reply for a chat selection", () => {
    render({ source: "chat", layout: "inline" });
    expect(actionLabels()).toEqual([
      "selectionMenu.pinSelection",
      "selectionMenu.replyToSelection",
    ]);
  });

  it("lays the actions out in one row instead of stacked rows", () => {
    render({ source: "chat", layout: "inline" });
    const bar = document.querySelector('[role="button"]')?.parentElement;
    expect(bar?.className).toContain("flex items-center");
    expect(bar?.className).not.toContain("flex-col");
    // One divider between two actions, none at the edges.
    expect(bar?.querySelectorAll("span").length).toBe(1);
  });

  it("hands the selected text to the action it ran", () => {
    const onPin = vi.fn();
    const onReply = vi.fn();
    const onClose = vi.fn();
    render({ source: "chat", layout: "inline", onPin, onReply, onClose });

    const [pinAction, replyAction] =
      document.querySelectorAll('[role="button"]');
    act(() => {
      pinAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledWith("the passage");

    act(() => {
      replyAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReply).toHaveBeenCalledWith("the passage");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the stacked menu for the other selection sources", () => {
    render({ source: "terminal" });
    expect(document.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(document.body.textContent).toContain("selectionMenu.addToChat");
  });
});
