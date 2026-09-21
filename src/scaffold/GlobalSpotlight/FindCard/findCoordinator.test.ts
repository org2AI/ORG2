// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_SHORTCUT_PLATFORM } from "@src/config/keyboard/shortcutBindings";

import {
  type FindScope,
  canSelectFindScope,
  openFindTargetNear,
  registerFindTarget,
  selectFindScope,
  subscribeFind,
} from "./findCoordinator";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});
function target(scope: FindScope, visible = true) {
  const element = document.createElement("input");
  const pane = document.createElement("div");
  if (scope === "file") pane.dataset.findScopeSwitching = "true";
  pane.append(element);
  document.body.append(pane);
  element.getClientRects = () =>
    (visible ? [{}] : []) as unknown as DOMRectList;
  const open = vi.fn(),
    close = vi.fn();
  cleanup.push(
    registerFindTarget({ scope, element: () => element, open, close })
  );
  return { element, open, close };
}
function press(element: HTMLElement) {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    code: "KeyF",
    bubbles: true,
    cancelable: true,
    metaKey: CURRENT_SHORTCUT_PLATFORM === "mac",
    ctrlKey: CURRENT_SHORTCUT_PLATFORM !== "mac",
  });
  element.dispatchEvent(event);
  return event;
}
describe("consolidated Find cycle", () => {
  it.each(["session", "file"] as const)(
    "opens focused %s, switches, then closes",
    (scope) => {
      const first = target(scope),
        second = target(scope === "session" ? "file" : "session");
      first.element.focus();
      expect(press(first.element).defaultPrevented).toBe(true);
      expect(first.open).toHaveBeenCalledOnce();
      press(first.element);
      expect(first.close).toHaveBeenCalledOnce();
      expect(second.open).toHaveBeenCalledOnce();
      press(first.element);
      expect(second.close).toHaveBeenCalledOnce();
    }
  );
  it("skips hidden targets and closes on the second press", () => {
    const session = target("session"),
      file = target("file", false);
    session.element.focus();
    press(session.element);
    press(session.element);
    expect(session.close).toHaveBeenCalledOnce();
    expect(file.open).not.toHaveBeenCalled();
  });
  it("pill switching closes the previous engine and next Find closes", () => {
    const session = target("session"),
      file = target("file");
    session.element.focus();
    press(session.element);
    selectFindScope("file");
    expect(session.close).toHaveBeenCalledOnce();
    expect(file.open).toHaveBeenCalledOnce();
    press(session.element);
    expect(file.close).toHaveBeenCalledOnce();
  });
  it("returns to the last focused file instead of a different mounted editor", () => {
    const session = target("session"),
      file = target("file"),
      unrelated = target("file");
    file.element.focus();
    session.element.focus();
    press(session.element);
    press(session.element);
    expect(file.open).toHaveBeenCalledOnce();
    expect(unrelated.open).not.toHaveBeenCalled();
  });
  it("removes the file scope when chat maximizes and restores it on return", async () => {
    const session = target("session"),
      file = target("file");
    session.element.focus();
    press(session.element);
    expect(canSelectFindScope("file")).toBe(true);
    file.element.parentElement!.setAttribute("aria-hidden", "true");
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(false);
    press(session.element);
    expect(session.close).toHaveBeenCalledOnce();
    expect(file.open).not.toHaveBeenCalled();
    file.element.parentElement!.removeAttribute("aria-hidden");
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(true);
  });
  it("requires the CodeMirror pane to be on the right in a split layout", async () => {
    target("session");
    const file = target("file");
    file.element.parentElement!.dataset.findScopeSwitching = "false";
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(false);
    file.element.parentElement!.dataset.findScopeSwitching = "true";
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(true);
    cleanup.pop()!();
    expect(canSelectFindScope("file")).toBe(false);
  });
  it("observes the layout for detached editor registration and disconnects on disposal", async () => {
    const surface = document.createElement("div");
    surface.dataset.workbenchSurface = "";
    surface.dataset.findScopeSwitching = "true";
    document.body.append(surface);
    const editor = document.createElement("input");
    editor.getClientRects = () => [{}] as unknown as DOMRectList;
    const dispose = registerFindTarget({
      scope: "file",
      element: () => editor,
      open: vi.fn(),
      close: vi.fn(),
    });
    surface.append(editor);
    surface.setAttribute("aria-hidden", "false");
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(true);
    surface.setAttribute("aria-hidden", "true");
    await Promise.resolve();
    expect(canSelectFindScope("file")).toBe(false);
    dispose();
    const listener = vi.fn();
    cleanup.push(subscribeFind(listener));
    surface.setAttribute("aria-hidden", "false");
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
  it.each(["toolbar", "xterm"])(
    "opens, switches and closes from %s focus",
    (className) => {
      const session = target("session"),
        file = target("file");
      const station = document.createElement("input");
      station.className = className;
      document.body.append(station);
      station.focus();
      expect(press(station).defaultPrevented).toBe(true);
      expect(session.open).toHaveBeenCalledOnce();
      press(station);
      expect(file.open).toHaveBeenCalledOnce();
      press(station);
      expect(file.close).toHaveBeenCalledOnce();
    }
  );
  it("opens a standalone editor from station chrome without a chat target", () => {
    const file = target("file");
    file.element.parentElement!.dataset.findScopeSwitching = "false";
    expect(press(document.body).defaultPrevented).toBe(true);
    expect(file.open).toHaveBeenCalledOnce();
    press(document.body);
    expect(file.close).toHaveBeenCalledOnce();
  });
  it("ignores hidden targets when resolving a global shortcut", () => {
    const session = target("session", false),
      file = target("file", false);
    expect(press(document.body).defaultPrevented).toBe(false);
    expect(session.open).not.toHaveBeenCalled();
    expect(file.open).not.toHaveBeenCalled();
  });
  it("does not intercept after releasing registration", () => {
    const session = target("session");
    session.element.focus();
    cleanup.pop()!();
    expect(press(session.element).defaultPrevented).toBe(false);
  });
  it("opens the file target sharing a pane with a header anchor", () => {
    const other = target("file"),
      near = target("file");
    const anchor = document.createElement("button");
    near.element.parentElement!.append(anchor);
    expect(openFindTargetNear(anchor, "file")).toBe(true);
    expect(near.open).toHaveBeenCalledOnce();
    expect(other.open).not.toHaveBeenCalled();
    // A second request keeps the open card rather than closing it.
    openFindTargetNear(anchor, "file");
    expect(near.close).not.toHaveBeenCalled();
  });
  it("reports no target when every candidate is hidden", () => {
    const file = target("file", false);
    expect(openFindTargetNear(file.element, "file")).toBe(false);
    expect(file.open).not.toHaveBeenCalled();
  });
});
