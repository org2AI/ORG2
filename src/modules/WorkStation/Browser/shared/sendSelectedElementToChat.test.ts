import { describe, expect, it, vi } from "vitest";

import type { AddToAgentRequest } from "@src/store/ui/addToAgentAtom";

import type { ElementInfo } from "../hooks/useWebviewInspector";
import { sendSelectedElementToChat } from "./sendSelectedElementToChat";

const element: ElementInfo = {
  tagName: "BUTTON",
  selector: "#save",
  id: "save",
  className: "action",
  attributes: {},
  innerText: "Save",
  innerHTML: "Save",
  rect: { x: 10, y: 20, width: 80, height: 30 },
  computedStyle: {
    display: "block",
    position: "static",
    color: null,
    backgroundColor: null,
    fontSize: null,
    fontFamily: null,
  },
  role: "button",
  xpath: "/button",
  sourceLocation: null,
};

describe("sendSelectedElementToChat", () => {
  it("does nothing without a selection", () => {
    const setAddToAgent = vi.fn();
    const onSent = vi.fn();
    const clearSelection = vi.fn();
    sendSelectedElementToChat({
      selectedElement: null,
      currentUrl: "https://example.com",
      setAddToAgent,
      onSent,
      clearSelection,
    });
    expect(setAddToAgent).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "sends the payload once with explicit clear policy %s",
    (clear) => {
      const calls: string[] = [];
      const setAddToAgent = vi.fn<(request: AddToAgentRequest) => void>(() => {
        calls.push("send");
      });
      const clearSelection = vi.fn(() => {
        calls.push("clear");
      });
      const onSent = () => {
        calls.push("toast");
      };
      sendSelectedElementToChat({
        selectedElement: element,
        currentUrl: "https://example.com/page",
        setAddToAgent,
        onSent,
        ...(clear ? { clearSelection } : {}),
      });
      expect(setAddToAgent).toHaveBeenCalledTimes(1);
      expect(setAddToAgent).toHaveBeenCalledWith({
        type: "dom-component",
        fileName: "button.json",
        jsonText: expect.any(String),
      });
      const payload = setAddToAgent.mock.calls[0];
      if (payload[0].type !== "dom-component")
        throw new Error("Expected DOM component payload");
      expect(JSON.parse(payload[0].jsonText)).toMatchObject({
        cssSelector: "#save",
        dimensions: { width: 80, height: 30 },
        meta: { url: "https://example.com/page" },
      });
      expect(calls).toEqual(
        clear ? ["send", "clear", "toast"] : ["send", "toast"]
      );
    }
  );
  it("does not clear or announce success if submission fails", () => {
    const clearSelection = vi.fn();
    const onSent = vi.fn();
    expect(() =>
      sendSelectedElementToChat({
        selectedElement: element,
        currentUrl: "",
        setAddToAgent: () => {
          throw new Error("failed");
        },
        clearSelection,
        onSent,
      })
    ).toThrow("failed");
    expect(clearSelection).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });
});
