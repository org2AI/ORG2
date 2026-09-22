// @vitest-environment jsdom
/**
 * The input guard is what makes the lock page more than a picture over the
 * app: while it is active nothing behind the page can take focus, a click or a
 * keystroke. These tests pin the two halves — `inert` on everything but the
 * lock page, and key events swallowed before any app shortcut handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_LOCK_ROOT_ID,
  activateAppLockInputGuard,
} from "../appLockInputGuard";

function keydown(target: EventTarget, key = "k"): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("app lock input guard", () => {
  let appRoot: HTMLDivElement;
  let lockRoot: HTMLDivElement;
  let lockInput: HTMLInputElement;
  let release: (() => void) | null = null;

  // Registered after the guard module loaded — like every real app shortcut.
  const windowCapture = vi.fn();
  const documentBubble = vi.fn();

  beforeEach(() => {
    appRoot = document.createElement("div");
    appRoot.id = "root";
    lockRoot = document.createElement("div");
    lockRoot.id = APP_LOCK_ROOT_ID;
    lockInput = document.createElement("input");
    lockRoot.append(lockInput);
    document.body.append(appRoot, lockRoot);
    window.addEventListener("keydown", windowCapture, true);
    document.addEventListener("keydown", documentBubble);
  });

  afterEach(() => {
    release?.();
    release = null;
    window.removeEventListener("keydown", windowCapture, true);
    document.removeEventListener("keydown", documentBubble);
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("lets key events through while inactive", () => {
    const event = keydown(appRoot);
    expect(windowCapture).toHaveBeenCalledTimes(1);
    expect(documentBubble).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("swallows shortcuts aimed at the app before any handler sees them", () => {
    release = activateAppLockInputGuard();
    const event = keydown(appRoot);
    expect(windowCapture).not.toHaveBeenCalled();
    expect(documentBubble).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("hides lock-page keystrokes from the app but keeps their default action", () => {
    release = activateAppLockInputGuard();
    const event = keydown(lockInput, "Enter");
    expect(windowCapture).not.toHaveBeenCalled();
    expect(documentBubble).not.toHaveBeenCalled();
    // Typing and Enter-to-submit are default actions; preventing them would
    // make the password field unusable.
    expect(event.defaultPrevented).toBe(false);
  });

  it("makes everything but the lock page inert, including later portals", async () => {
    release = activateAppLockInputGuard();
    expect(appRoot.hasAttribute("inert")).toBe(true);
    expect(lockRoot.hasAttribute("inert")).toBe(false);

    const toast = document.createElement("div");
    document.body.append(toast);
    await Promise.resolve();
    expect(toast.hasAttribute("inert")).toBe(true);

    release();
    release = null;
    expect(appRoot.hasAttribute("inert")).toBe(false);
    expect(toast.hasAttribute("inert")).toBe(false);
    keydown(appRoot);
    expect(windowCapture).toHaveBeenCalledTimes(1);
  });

  it("does not re-enable an element that was inert for another reason", () => {
    const alreadyInert = document.createElement("div");
    alreadyInert.setAttribute("inert", "");
    document.body.append(alreadyInert);

    release = activateAppLockInputGuard();
    release();
    release = null;
    expect(alreadyInert.hasAttribute("inert")).toBe(true);
  });

  it("blurs the control that had focus behind the lock", () => {
    const field = document.createElement("input");
    appRoot.append(field);
    field.focus();
    expect(document.activeElement).toBe(field);

    release = activateAppLockInputGuard();
    expect(document.activeElement).not.toBe(field);
  });
});
