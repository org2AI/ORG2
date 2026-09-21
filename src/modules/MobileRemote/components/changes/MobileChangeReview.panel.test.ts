// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import { MobileChangeReview } from "./MobileChangeReview";
import type { ChangeFile } from "./useChangeReview";

const copy = vi.hoisted(() => vi.fn());
vi.mock("../../platform", async () => {
  const { createBrowserMobileRemotePlatform } =
    await import("../../platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { useMobileRemotePlatform: () => platform };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key} (${options.count})`,
  }),
}));
vi.mock("@src/scaffold/ModalSystem", () => ({
  default: ({
    children,
    title,
    headerActions,
    onClose,
    closable,
    className,
  }: React.PropsWithChildren<{
    title: React.ReactNode;
    headerActions?: React.ReactNode;
    onClose: () => void;
    closable?: boolean;
    className?: string;
  }>) =>
    React.createElement(
      "div",
      { role: "dialog", className },
      title,
      headerActions,
      children,
      closable !== false &&
        React.createElement("button", { onClick: onClose }, "close")
    ),
}));
vi.mock("../transcript/useMobileCopyText", () => ({
  useMobileCopyText: () => ({ state: "idle", copy }),
}));
vi.mock("../transcript/MobileReadonlyEditor", () => ({
  default: ({
    content,
    wrap,
    height,
  }: {
    content: string;
    wrap: boolean;
    height?: string;
  }) =>
    React.createElement(
      "pre",
      { "data-wrap": String(wrap), "data-height": height },
      content
    ),
}));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let intersectImmediately: boolean;
let observers: { callback: (entries: unknown[]) => void; active: boolean }[];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);
const firstFile: ChangeFile = {
  path: "src/a.ts",
  additions: 3,
  deletions: 1,
  patches: [],
  before: "before a",
  after: "after a",
  availability: "snapshots",
};
const secondFile = { ...firstFile, path: "src/b.ts", after: "after b" };
const review = (files: ChangeFile[] = [firstFile]) => ({
  complete: true,
  files,
});

it("projects lazy patch responses into real numbered rows and expands long patches without another request", async () => {
  const patch = `--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,100 @@\n${Array.from({ length: 100 }, (_, i) => `+const value${i + 1} = ${i + 1};`).join("\n")}\n`;
  const changed: ChangeFile = {
    ...firstFile,
    before: null,
    after: null,
    patches: [patch],
    availability: "patch_only",
  };
  const call = vi.fn(async (_method, params) =>
    review([{ ...changed, patches: params.filePath ? [patch] : [] }])
  );
  await render(propsFor(call));
  await tick();
  await open();
  await tick();
  expect(panel().querySelectorAll(".mobile-patch-diff__line")).toHaveLength(80);
  expect(panel().querySelector(".mobile-patch-diff__number")?.textContent).toBe(
    "1"
  );
  expect(panel().textContent).not.toContain("/dev/null");
  expect(panel().textContent).not.toContain("@@");
  const requests = call.mock.calls.length;
  await act(async () =>
    panel()
      .querySelector<HTMLButtonElement>(".mobile-patch-diff__more")!
      .click()
  );
  expect(panel().querySelectorAll(".mobile-patch-diff__line")).toHaveLength(
    100
  );
  expect(call).toHaveBeenCalledTimes(requests);
  await act(async () => panelButton("changeReview.full: src/a.ts").click());
  await tick();
  expect(panel().textContent).toContain("changeReview.unavailable");
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  copy.mockClear();
  intersectImmediately = true;
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private record;
      constructor(callback: (entries: unknown[]) => void) {
        this.record = { callback, active: false };
        observers.push(this.record);
      }
      observe() {
        this.record.active = true;
        if (intersectImmediately)
          this.record.callback([{ isIntersecting: true }]);
      }
      disconnect() {
        this.record.active = false;
      }
    }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalScrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});
const panel = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const panelButton = (label: string) =>
  Array.from(panel().querySelectorAll("button")).find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label
  )!;
const accessibleDropdownName = (trigger: HTMLElement) => {
  expect(trigger.hasAttribute("aria-label")).toBe(false);
  const ids = trigger.getAttribute("aria-labelledby")!.split(" ");
  expect(ids).toHaveLength(2);
  return ids
    .map((id) => {
      const element = document.getElementById(id);
      expect(element).not.toBeNull();
      return element!.textContent;
    })
    .join(" ");
};
const tick = async () => {
  await act(async () => vi.advanceTimersByTimeAsync(300));
};
const propsFor = (call: ReturnType<typeof vi.fn>) => ({
  client: { call } as unknown as MobileRpcClient,
  sessionId: "panel",
  roundId: "one",
  online: true,
  revision: "1",
});
const render = async (props: ReturnType<typeof propsFor>) => {
  await act(async () =>
    root.render(React.createElement(MobileChangeReview, props))
  );
};
const open = async () => {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(".mobile-change-review__heading")!
      .click()
  );
  await tick();
};
const scope = async (value: "turn" | "session" | "workspace") => {
  await act(async () => {
    panel()
      .querySelector<HTMLButtonElement>(".mobile-change-review__scope button")!
      .click();
  });
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((option) => option.textContent?.includes(`changeReview.${value}`))!
      .click();
  });
};
const mode = async (value: "diff" | "full") => {
  await act(async () =>
    panel()
      .querySelector<HTMLButtonElement>(
        `.mobile-change-review__mode [data-tab-key="${value}"]`
      )!
      .click()
  );
};
const inViewport = async (visible: boolean) => {
  await act(async () =>
    observers
      .filter((observer) => observer.active)
      .forEach((observer) => observer.callback([{ isIntersecting: visible }]))
  );
};
const fileToggle = () =>
  panel().querySelector<HTMLButtonElement>(
    ".mobile-change-review__file-toggle"
  )!;

it("retries a failed panel manifest with a pending state and no duplicate turn request", async () => {
  const retry = deferred();
  let sessionAttempts = 0;
  const call = vi.fn().mockImplementation((_method, params) => {
    if (params.scope === "session" && !params.filePath) {
      sessionAttempts++;
      return sessionAttempts === 1
        ? Promise.reject(new Error("private failure"))
        : retry.promise;
    }
    return Promise.resolve(review());
  });
  await render(propsFor(call));
  await tick();
  await open();
  await scope("session");
  await tick();
  expect(panel().querySelector('[data-state="error"]')?.textContent).toContain(
    "changeReview.loadFailed"
  );
  expect(panel().textContent).not.toContain("private failure");
  expect(
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )?.disabled
  ).toBe(true);
  await act(async () => panelButton("changeReview.retry").click());
  expect(panel().querySelector('[data-state="error"]')).toBeNull();
  expect(panel().querySelector('[data-state="loading"]')).not.toBeNull();
  expect(
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )?.disabled
  ).toBe(true);
  await tick();
  expect(sessionAttempts).toBe(2);
  await act(async () => retry.resolve(review()));
  await tick();
  expect(panel().querySelector('[data-state="error"]')).toBeNull();
  expect(panel().querySelector("pre")?.textContent).toBe("after a");
  expect(
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )?.disabled
  ).toBe(false);
  expect(
    call.mock.calls.filter(
      ([, params]) => params.scope === "turn" && !params.filePath
    )
  ).toHaveLength(1);
});

it("keeps the newer scope visible when an aborted old-scope response arrives", async () => {
  const old = deferred();
  let oldSignal!: AbortSignal;
  const call = vi.fn().mockImplementation((_method, params, signal) => {
    if (params.scope === "session") {
      oldSignal = signal;
      return old.promise;
    }
    return Promise.resolve(
      review(
        params.scope === "workspace"
          ? [{ ...firstFile, path: "workspace.ts" }]
          : [firstFile]
      )
    );
  });
  await render(propsFor(call));
  await tick();
  await open();
  await scope("session");
  await tick();
  await scope("workspace");
  await tick();
  expect(oldSignal.aborted).toBe(true);
  expect(panel().textContent).toContain("workspace.ts");
  await act(async () =>
    old.resolve(review([{ ...firstFile, path: "stale-session.ts" }]))
  );
  expect(panel().textContent).toContain("workspace.ts");
  expect(panel().textContent).not.toContain("stale-session.ts");
});

it("shows the first available full file after a refreshed manifest removes the selected path", async () => {
  let files = [firstFile, secondFile];
  const call = vi.fn().mockImplementation(() => Promise.resolve(review(files)));
  const props = propsFor(call);
  await render(props);
  await tick();
  const row = host.querySelector<HTMLButtonElement>(
    '[data-mobile-change-path="src/b.ts"]'
  )!;
  await act(async () => row.click());
  await mode("full");
  await tick();
  expect(panel().querySelector("pre")?.textContent).toBe("after b");
  files = [
    { ...firstFile, path: "src/c.ts", after: "new file c" },
    { ...firstFile, path: "src/d.ts", after: "new file d" },
  ];
  await render({ ...props, revision: "2" });
  await tick();
  await tick();
  expect(
    panel().querySelector(".mobile-change-review__file-heading")?.textContent
  ).toContain("c.ts");
  expect(panel().querySelector("pre")?.textContent).toBe("new file c");
  expect(
    accessibleDropdownName(
      panel().querySelector<HTMLElement>(
        ".mobile-change-review__file-picker button"
      )!
    )
  ).toBe("changeReview.file src/c.ts");
  expect(panel().textContent).not.toContain("b.ts");
});

it("distinguishes unavailable snapshots, empty scope, and disconnected desktop", async () => {
  const call = vi
    .fn()
    .mockImplementation((_method, params) =>
      Promise.resolve(
        params.scope === "session"
          ? review([])
          : review([{ ...firstFile, before: null, after: null }])
      )
    );
  const props = propsFor(call);
  await render(props);
  await tick();
  await open();
  await mode("full");
  await tick();
  expect(panel().querySelector('[data-state="unavailable"]')).not.toBeNull();
  expect(panel().querySelector('[data-state="empty"]')).toBeNull();
  await mode("diff");
  await scope("session");
  await tick();
  expect(panel().querySelector('[data-state="empty"]')).not.toBeNull();
  expect(panel().querySelector('[data-state="unavailable"]')).toBeNull();
  expect(
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )?.disabled
  ).toBe(true);
  await render({ ...props, online: false });
  const count = call.mock.calls.length;
  await tick();
  expect(panel().querySelector('[data-state="offline"]')).not.toBeNull();
  expect(panel().querySelector('[data-state="empty"]')).toBeNull();
  expect(
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )?.disabled
  ).toBe(true);
  expect(call).toHaveBeenCalledTimes(count);
});

it("aborts panel-owned pending requests on close without destroying the inline turn manifest", async () => {
  const pending = deferred();
  let scopedSignal!: AbortSignal;
  const call = vi.fn().mockImplementation((_method, params, signal) => {
    if (params.scope === "session") {
      scopedSignal = signal;
      return pending.promise;
    }
    return Promise.resolve(review());
  });
  await render(propsFor(call));
  await tick();
  await open();
  await scope("session");
  await tick();
  await act(async () => panelButton("common:actions.close").click());
  expect(scopedSignal.aborted).toBe(true);
  expect(panel()).toBeNull();
  await act(async () =>
    pending.resolve(review([{ ...firstFile, path: "late.ts" }]))
  );
  expect(host.textContent).toContain("a.ts");
  expect(
    host.querySelector('[data-mobile-change-path="src/a.ts"]')
  ).not.toBeNull();
  expect(host.textContent).not.toContain("late.ts");
  await open();
  expect(panel().textContent).toContain("a.ts");
  expect(
    call.mock.calls.filter(
      ([, params]) => params.scope === "turn" && !params.filePath
    )
  ).toHaveLength(1);
});

it("uses segmented modes and real icon-only controls with mobile geometry", async () => {
  const call = vi.fn().mockResolvedValue(review());
  await render(propsFor(call));
  await tick();
  await open();
  const modes = panel().querySelector(".mobile-change-review__mode")!;
  expect(modes.tagName).not.toBe("SELECT");
  expect(modes.querySelectorAll("button")).toHaveLength(2);
  expect(panel().querySelector("pre")?.dataset.height).toBe("auto");
  expect(
    modes.querySelector('[data-tab-key="diff"]')?.getAttribute("data-active")
  ).toBe("true");
  expect(
    modes.querySelector('[data-tab-key="diff"] .sr-only')?.textContent
  ).toBe("changeReview.selected");
  expect(modes.querySelector('[data-tab-key="full"] .sr-only')).toBeNull();
  const scopes = panel().querySelector<HTMLButtonElement>(
    ".mobile-change-review__scope button"
  )!;
  expect(accessibleDropdownName(scopes)).toBe(
    "changeReview.scope changeReview.turn"
  );
  expect(panel().querySelector("select")).toBeNull();
  await act(async () => scopes.click());
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(
    document
      .querySelector(".mobile-change-review-menu")
      ?.classList.contains("mobile-change-review-menu--scope")
  ).toBe(true);
  expect(
    document.querySelector(".mobile-change-review-menu--files")
  ).toBeNull();
  await act(async () => scopes.click());
  expect(
    panel().querySelector<HTMLDetailsElement>(
      ".mobile-change-review__file-actions"
    )?.open
  ).toBe(false);
  const icons = [
    panelButton("common:actions.close"),
    panelButton("changeReview.wrap"),
    panelButton("changeReview.copy"),
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )!,
  ];
  for (const icon of icons) {
    expect(icon.classList.contains("button")).toBe(true);
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(icon.querySelector(".truncate")).toBeNull();
    const size =
      icon === icons[0]
        ? "var(--mobile-header-icon-button-size)"
        : "var(--mobile-change-touch-size)";
    expect(icon.style.width).toBe(size);
    expect(icon.style.height).toBe(size);
    expect(icon.style.padding).toBe("0px");
  }
  expect(icons[0].style.borderRadius).toBe("50%");
  await act(async () => panelButton("changeReview.copy").click());
  expect(copy).toHaveBeenCalledTimes(1);
  await mode("full");
  await tick();
  expect(panel().querySelector("pre")?.dataset.height).toBe("100%");
  expect(
    modes.querySelector('[data-tab-key="full"]')?.getAttribute("data-active")
  ).toBe("true");
  expect(
    modes.querySelector('[data-tab-key="full"] .sr-only')?.textContent
  ).toBe("changeReview.selected");
  expect(modes.querySelector('[data-tab-key="diff"] .sr-only')).toBeNull();
  expect(panel().querySelector(".mobile-change-review__expand-all")).toBeNull();
  await scope("session");
  expect(accessibleDropdownName(scopes)).toBe(
    "changeReview.scope changeReview.session"
  );
});

it("uses the shared searchable file dropdown and disposes its portal when review closes", async () => {
  const call = vi
    .fn()
    .mockImplementation((_method, params) =>
      Promise.resolve(
        review(
          [firstFile, secondFile].filter(
            (file) => !params.filePath || params.filePath === file.path
          )
        )
      )
    );
  await render(propsFor(call));
  await tick();
  await open();
  await mode("full");
  await tick();
  const trigger = panel().querySelector<HTMLButtonElement>(
    ".mobile-change-review__file-picker button"
  )!;
  expect(accessibleDropdownName(trigger)).toBe("changeReview.file src/a.ts");
  expect(panel().querySelector("select")).toBeNull();
  const requests = call.mock.calls.length;
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const input = document.querySelector<HTMLInputElement>(
    ".mobile-change-review-menu input"
  )!;
  expect(input).not.toBeNull();
  expect(
    document.querySelector(".mobile-change-review-menu--files")
  ).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "b.ts");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(call).toHaveBeenCalledTimes(requests);
  await act(async () =>
    document.querySelector<HTMLElement>('[role="option"]')!.click()
  );
  await tick();
  expect(panel().querySelector("pre")?.textContent).toBe("after b");
  expect(accessibleDropdownName(trigger)).toBe("changeReview.file src/b.ts");
  expect(document.querySelector(".mobile-change-review-menu")).toBeNull();
  await act(async () => trigger.click());
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  const modalEscape = vi.fn();
  document.addEventListener("keydown", modalEscape);
  await act(async () =>
    document
      .querySelector<HTMLInputElement>(".mobile-change-review-menu input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
  );
  document.removeEventListener("keydown", modalEscape);
  expect(modalEscape).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector(".mobile-change-review-menu")).toBeNull();
  expect(panel()).not.toBeNull();
  await act(async () => trigger.click());
  await act(async () => panelButton("common:actions.close").click());
  expect(document.querySelector(".mobile-change-review-menu")).toBeNull();
});

it("opens full content even after every diff file was collapsed", async () => {
  const call = vi.fn().mockResolvedValue(review([firstFile, secondFile]));
  await render(propsFor(call));
  await tick();
  await open();
  const expandAll = () =>
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )!;
  await act(async () => expandAll().click());
  await act(async () => expandAll().click());
  expect(fileToggle().getAttribute("aria-expanded")).toBe("false");
  await mode("full");
  await tick();
  expect(panel().querySelector("pre")?.textContent).toBe("after a");
  expect(fileToggle().disabled).toBe(true);
});

it("a repeated expand-all command supersedes an older manual file collapse", async () => {
  const call = vi.fn().mockResolvedValue(review([firstFile, secondFile]));
  await render(propsFor(call));
  await tick();
  await open();
  const expandAll = () =>
    panel().querySelector<HTMLButtonElement>(
      ".mobile-change-review__expand-all"
    )!;
  expect(expandAll().getAttribute("aria-label")).toBe("changeReview.expandAll");
  expect(
    expandAll().querySelector('[data-icon="chevrons-up-down"]')
  ).not.toBeNull();
  await act(async () => expandAll().click());
  expect(expandAll().getAttribute("aria-label")).toBe(
    "changeReview.collapseAll"
  );
  expect(
    expandAll().querySelector('[data-icon="chevrons-down-up"]')
  ).not.toBeNull();
  await act(async () => fileToggle().click());
  expect(fileToggle().getAttribute("aria-expanded")).toBe("false");
  await act(async () => expandAll().click());
  expect(expandAll().getAttribute("title")).toBe("changeReview.expandAll");
  expect(
    expandAll().querySelector('[data-icon="chevrons-up-down"]')
  ).not.toBeNull();
  await act(async () => expandAll().click());
  expect(fileToggle().getAttribute("aria-expanded")).toBe("true");
  expect(
    Array.from(
      panel().querySelectorAll(".mobile-change-review__file-toggle")
    ).every((entry) => entry.getAttribute("aria-expanded") === "true")
  ).toBe(true);
});

it("keeps detail work viewport-gated and aborts it when the file collapses", async () => {
  intersectImmediately = false;
  const pending = deferred();
  let detailSignal!: AbortSignal;
  const call = vi.fn().mockImplementation((_method, params, signal) => {
    if (params.filePath) {
      detailSignal = signal;
      return pending.promise;
    }
    return Promise.resolve(review());
  });
  await render(propsFor(call));
  await tick();
  await open();
  expect(call.mock.calls.filter(([, params]) => params.filePath)).toHaveLength(
    0
  );
  await inViewport(true);
  await tick();
  expect(call.mock.calls.filter(([, params]) => params.filePath)).toHaveLength(
    1
  );
  await act(async () => fileToggle().click());
  expect(detailSignal.aborted).toBe(true);
  await act(async () => pending.resolve(review()));
  expect(panel().querySelector("pre")).toBeNull();
});

it("falls back to an available after snapshot when a reloaded file no longer has its selected before side", async () => {
  let currentFile = firstFile;
  const call = vi
    .fn()
    .mockImplementation(() => Promise.resolve(review([currentFile])));
  await render(propsFor(call));
  await tick();
  await open();
  await mode("full");
  await tick();
  await act(async () => panelButton("changeReview.after").click());
  expect(panel().querySelector("pre")?.textContent).toBe("before a");
  await inViewport(false);
  currentFile = { ...firstFile, before: null, after: "reloaded after" };
  await inViewport(true);
  await tick();
  expect(panel().querySelector("pre")?.textContent).toBe("reloaded after");
  expect(panelButton("changeReview.after").disabled).toBe(true);
  expect(panel().querySelector('[data-state="unavailable"]')).toBeNull();
});

it("renders an empty-string full snapshot as valid content instead of an unavailable file", async () => {
  const call = vi.fn().mockResolvedValue(review([{ ...firstFile, after: "" }]));
  await render(propsFor(call));
  await tick();
  await open();
  await mode("full");
  await tick();
  expect(panel().querySelector("pre")).not.toBeNull();
  expect(panel().querySelector("pre")?.textContent).toBe("");
  expect(panel().querySelector('[data-state="unavailable"]')).toBeNull();
  expect(panelButton("changeReview.copy").disabled).toBe(false);
  await act(async () => panelButton("changeReview.after").click());
  expect(panel().querySelector("pre")?.textContent).toBe("before a");
  await act(async () => panelButton("changeReview.before").click());
  expect(panel().querySelector("pre")?.textContent).toBe("");
});

it("renders reconstructed history with provenance and allows both complete versions", async () => {
  const call = vi
    .fn()
    .mockResolvedValue(
      review([{ ...firstFile, availability: "reconstructed_from_history" }])
    );
  await render(propsFor(call));
  await tick();
  await open();
  await mode("full");
  await tick();
  expect(panel().textContent).toContain("changeReview.reconstructed");
  expect(panel().querySelector("pre")?.textContent).toBe(firstFile.after);
  expect(panel().querySelector('[data-state="unavailable"]')).toBeNull();
  await act(async () => panelButton("changeReview.after").click());
  expect(panel().querySelector("pre")?.textContent).toBe(firstFile.before);
  expect(panelButton("changeReview.copy").disabled).toBe(false);
});

it("preserves the live editor, wrapping and disclosure through manifest/detail refresh and retry", async () => {
  let refresh = false;
  let fail = false;
  const pending = deferred();
  const call = vi.fn().mockImplementation(() => {
    if (refresh)
      return fail ? Promise.reject(new Error("network")) : pending.promise;
    return Promise.resolve(review());
  });
  const props = propsFor(call);
  await render(props);
  await tick();
  await open();
  const editor = panel().querySelector("pre")!;
  editor.scrollTop = 77;
  const actions = panel().querySelector<HTMLDetailsElement>(
    ".mobile-change-review__file-actions"
  )!;
  actions.open = true;
  await act(async () => panelButton("changeReview.wrap").click());
  expect(editor.dataset.wrap).toBe("false");
  refresh = true;
  await render({ ...props, revision: "2" });
  expect(panel().querySelector("pre")).toBe(editor);
  expect(panel().querySelector('[data-state="refreshing"]')).not.toBeNull();
  fail = true;
  await tick();
  expect(panel().querySelector('[data-state="refresh-error"]')).not.toBeNull();
  expect(panel().querySelector("pre")).toBe(editor);
  fail = false;
  await act(async () => {
    for (const button of panel().querySelectorAll<HTMLButtonElement>(
      ".mobile-change-state__retry"
    ))
      button.click();
  });
  await tick();
  expect(panel().querySelector("pre")).toBe(editor);
  await act(async () =>
    pending.resolve(review([{ ...firstFile, after: "new after" }]))
  );
  expect(panel().querySelector("pre")).toBe(editor);
  expect(editor.textContent).toBe("new after");
  expect(editor.dataset.wrap).toBe("false");
  expect(editor.scrollTop).toBe(77);
  expect(actions.open).toBe(true);
  expect(panel().querySelector('[data-state="refresh-error"]')).toBeNull();
  expect(call).toHaveBeenCalledTimes(6);
});

it("preserves collapsed files across revisions without requesting their detail", async () => {
  const call = vi.fn().mockResolvedValue(review());
  const props = propsFor(call);
  await render(props);
  await tick();
  await open();
  await act(async () => fileToggle().click());
  const toggle = fileToggle();
  const detailCalls = call.mock.calls.filter(
    ([, params]) => params.filePath
  ).length;
  await render({ ...props, revision: "2" });
  await tick();
  expect(fileToggle()).toBe(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(call.mock.calls.filter(([, params]) => params.filePath)).toHaveLength(
    detailCalls
  );
});

it("evicts offscreen heavy content while preserving measured space until detail returns", async () => {
  const call = vi.fn().mockResolvedValue(review());
  await render(propsFor(call));
  await tick();
  await open();
  const section = panel().querySelector<HTMLElement>(
    ".mobile-change-review__file"
  )!;
  vi.spyOn(section, "getBoundingClientRect").mockReturnValue({
    height: 720,
  } as DOMRect);
  await inViewport(false);
  expect(panel().querySelector("pre")).toBeNull();
  expect(section.style.minHeight).toBe("720px");
  const previousRequests = call.mock.calls.length;
  await tick();
  expect(call).toHaveBeenCalledTimes(previousRequests);
  await inViewport(true);
  expect(section.style.minHeight).toBe("720px");
  await tick();
  expect(panel().querySelector("pre")).not.toBeNull();
  expect(section.style.minHeight).toBe("");
  await act(async () => fileToggle().click());
  expect(section.style.minHeight).toBe("");
});

it.each(["sessionId", "roundId", "client"] as const)(
  "does not retain content across %s changes",
  async (field) => {
    const pending = deferred();
    const call = vi.fn().mockResolvedValue(review());
    const props = propsFor(call);
    await render(props);
    await tick();
    await open();
    const editor = panel().querySelector("pre");
    call.mockReturnValue(pending.promise);
    await render({
      ...props,
      [field]: field === "client" ? { call } : "different",
    });
    expect(panel().querySelector("pre")).toBeNull();
    expect(editor?.isConnected).toBe(false);
    expect(panel().textContent).not.toContain("after a");
  }
);

it("keeps the opened workspace scope when refreshed turn changes become empty", async () => {
  let emptyTurn = false;
  const call = vi
    .fn()
    .mockImplementation((_method, params) =>
      Promise.resolve(
        review(emptyTurn && params.scope === "turn" ? [] : [firstFile])
      )
    );
  const props = propsFor(call);
  await render(props);
  await tick();
  await open();
  await scope("workspace");
  await tick();
  await tick();
  const editor = panel().querySelector("pre");
  expect(editor).not.toBeNull();
  emptyTurn = true;
  await render({ ...props, revision: "2" });
  await tick();
  expect(host.querySelector(".mobile-change-review__heading")).toBeNull();
  expect(
    accessibleDropdownName(
      panel().querySelector<HTMLButtonElement>(
        ".mobile-change-review__scope button"
      )!
    )
  ).toBe("changeReview.scope changeReview.workspace");
  expect(panel().querySelector("pre")).toBe(editor);
});
