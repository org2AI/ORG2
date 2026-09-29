// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getChatDropTargetId,
  isDropInsideChatDropTarget,
} from "./dragDetection";
import { hasVisibleChatDropTarget } from "./routeUtils";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("retained Workstation chat drop targets", () => {
  it.each(["aria-hidden", "inert", "hidden"])(
    "excludes a sized target under %s and restores it on reveal",
    (attribute) => {
      vi.stubGlobal("DragEvent", class extends Event {});
      const surface = document.createElement("div");
      const target = document.createElement("div");
      target.dataset.chatDropTarget = "true";
      target.dataset.chatDropTargetId = "workstation-chat";
      target.getBoundingClientRect = () =>
        ({
          left: 20,
          top: 20,
          right: 120,
          bottom: 120,
          width: 100,
          height: 100,
        }) as DOMRect;
      surface.append(target);
      document.body.append(surface);
      // Native hit testing may hit the underlying pane; the fallback scans rectangles.
      document.elementFromPoint = () => document.body;
      const position = { x: 50, y: 50 };
      expect(hasVisibleChatDropTarget()).toBe(true);
      expect(getChatDropTargetId(position)).toBe("workstation-chat");
      surface.setAttribute(
        attribute,
        attribute === "aria-hidden" ? "true" : ""
      );
      expect(hasVisibleChatDropTarget()).toBe(false);
      expect(getChatDropTargetId(position)).toBeUndefined();
      expect(isDropInsideChatDropTarget(position)).toBe(false);
      const event = new Event("drop");
      target.dispatchEvent(event);
      expect(getChatDropTargetId(event)).toBeUndefined();
      expect(isDropInsideChatDropTarget(event)).toBe(false);
      surface.removeAttribute(attribute);
      expect(getChatDropTargetId(position)).toBe("workstation-chat");
    }
  );
});
