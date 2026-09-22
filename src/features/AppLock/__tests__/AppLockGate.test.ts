// @vitest-environment jsdom
/**
 * AppLockGate against a fake backend: the window must stay covered until the
 * backend answers, show the password page when locked, keep the app inert
 * behind it, and open only when the backend says the password was right.
 */
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLockStatus } from "@src/api/tauri/appLock";

import { AppLockGate } from "../AppLockGate";

const backend = vi.hoisted(() => ({
  invoke: vi.fn(),
  // Handlers, not event names: `useTauriListen` unlistens on a later
  // macrotask, so a name-keyed map would let one test's deferred cleanup
  // remove the next test's subscription.
  listeners: new Set<(event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: backend.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (_event: string, handler: (event: { payload: unknown }) => void) => {
      backend.listeners.add(handler);
      return () => backend.listeners.delete(handler);
    }
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const status = (overrides: Partial<AppLockStatus> = {}): AppLockStatus => ({
  enabled: true,
  locked: true,
  lockOnLaunch: false,
  autoLockMinutes: 0,
  hint: null,
  retryAfterMs: 0,
  ...overrides,
});

const flush = () => act(async () => Promise.resolve());

function lockRoot(): HTMLElement | null {
  return document.querySelector('[data-testid="app-lock-root"]');
}

async function typePassword(value: string): Promise<void> {
  const input = lockRoot()?.querySelector("input");
  if (!input) throw new Error("password field missing");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  const form = lockRoot()?.querySelector("form");
  if (!form) throw new Error("form missing");
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
  await flush();
}

describe("AppLockGate", () => {
  let appRoot: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.append(appRoot);
    root = createRoot(appRoot);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    backend.invoke.mockReset();
    backend.listeners.clear();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store: createStore() },
          createElement(AppLockGate)
        )
      );
    });
  }

  it("covers the window until the backend answers, then opens when unlocked", async () => {
    let answer: (value: AppLockStatus) => void = () => {};
    backend.invoke.mockImplementation(
      () => new Promise<AppLockStatus>((resolve) => (answer = resolve))
    );
    await mount();

    expect(lockRoot()?.getAttribute("data-app-lock-mode")).toBe("cover");
    expect(lockRoot()?.querySelector("input")).toBeNull();
    expect(appRoot.hasAttribute("inert")).toBe(true);

    await act(async () => answer(status({ enabled: false, locked: false })));
    expect(lockRoot()).toBeNull();
    expect(appRoot.hasAttribute("inert")).toBe(false);
  });

  it("opens rather than staying blank when the backend has no lock commands", async () => {
    backend.invoke.mockRejectedValue("command app_lock_status not found");
    await mount();
    await flush();
    expect(lockRoot()).toBeNull();
  });

  it("rejects a wrong password and opens on the right one", async () => {
    backend.invoke.mockImplementation(
      async (command: string, args?: { password?: string }) => {
        if (command === "app_lock_status") return status();
        if (command === "app_lock_unlock") {
          const unlocked = args?.password === "hunter2";
          return { unlocked, status: status({ locked: !unlocked }) };
        }
        throw new Error(`unexpected command ${command}`);
      }
    );
    await mount();
    await flush();

    expect(lockRoot()?.getAttribute("data-app-lock-mode")).toBe("locked");
    expect(appRoot.hasAttribute("inert")).toBe(true);

    await typePassword("nope");
    await submit();
    expect(lockRoot()?.textContent).toContain("appLock.screen.incorrect");
    expect(lockRoot()?.querySelector("input")?.value).toBe("");
    expect(appRoot.hasAttribute("inert")).toBe(true);

    await typePassword("hunter2");
    await submit();
    expect(lockRoot()).toBeNull();
    expect(appRoot.hasAttribute("inert")).toBe(false);
  });

  it("shows the throttle and refuses input while it runs", async () => {
    backend.invoke.mockResolvedValue(status({ retryAfterMs: 30_000 }));
    await mount();
    await flush();

    expect(lockRoot()?.textContent).toContain("appLock.screen.throttled");
    expect(lockRoot()?.querySelector("input")?.disabled).toBe(true);
  });

  it("locks when another window or the idle timer locks the app", async () => {
    backend.invoke.mockResolvedValue(status({ locked: false }));
    await mount();
    await flush();
    expect(lockRoot()).toBeNull();

    await act(async () => {
      for (const handler of backend.listeners) handler({ payload: status() });
    });
    expect(lockRoot()?.getAttribute("data-app-lock-mode")).toBe("locked");
  });

  it("keeps the hint off the page until it is asked for", async () => {
    backend.invoke.mockResolvedValue(status({ hint: "the usual one" }));
    await mount();
    await flush();

    // Anyone can walk past a locked screen; the hint is for the owner who
    // is stuck, so it takes a deliberate click.
    expect(lockRoot()?.textContent).not.toContain("the usual one");
    const reveal = Array.from(
      lockRoot()?.querySelectorAll("button") ?? []
    ).find((button) => button.textContent === "appLock.screen.showHint");
    expect(reveal).toBeDefined();

    await act(async () => reveal?.click());
    expect(lockRoot()?.textContent).toContain("appLock.screen.hint");
  });

  it("offers no hint control when no hint is set", async () => {
    backend.invoke.mockResolvedValue(status());
    await mount();
    await flush();
    expect(lockRoot()?.textContent).not.toContain("appLock.screen.showHint");
  });

  it("never passes the password to the logger", async () => {
    const spies = [
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    backend.invoke.mockImplementation(async (command: string) => {
      if (command === "app_lock_status") return status();
      throw "app_lock:write_failed: disk full";
    });
    await mount();
    await flush();
    await typePassword("s3cret-value");
    await submit();

    expect(lockRoot()?.textContent).toContain("appLock.screen.failed");
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("s3cret-value");
      spy.mockRestore();
    }
  });
});
