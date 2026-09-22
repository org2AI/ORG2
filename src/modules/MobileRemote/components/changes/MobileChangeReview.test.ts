// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import { MobileChangeReview } from "./MobileChangeReview";
import { validateReview } from "./useChangeReview";

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
    onClose,
    headerActions,
    closable,
  }: React.PropsWithChildren<{
    title: React.ReactNode;
    onClose: () => void;
    headerActions?: React.ReactNode;
    closable?: boolean;
  }>) =>
    React.createElement(
      "div",
      { role: "dialog" },
      title,
      headerActions,
      children,
      closable !== false &&
        React.createElement("button", { onClick: onClose }, "close")
    ),
}));
vi.mock("../transcript/useMobileCopyText", () => ({
  useMobileCopyText: () => ({ state: "idle", copy: vi.fn() }),
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
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);
const file = {
  path: "a.ts",
  additions: 1,
  deletions: 1,
  patches: [],
  before: null,
  after: null,
  availability: "patch_only",
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
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (v: unknown[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
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
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.startsWith(text) ||
      (text === "close" &&
        b.getAttribute("aria-label") === "common:actions.close")
  )!;
const summaryHeading = () =>
  host.querySelector<HTMLElement>(".mobile-change-review__heading")!;
const selectScope = async (value: string) => {
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(".mobile-change-review__scope button")!
      .click();
  });
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find((option) => option.textContent?.includes(`changeReview.${value}`))!
      .click();
  });
};
const selectMode = async (value: "diff" | "full") => {
  await act(async () => {
    const mode = host.querySelector<HTMLElement>(
      ".mobile-change-review__mode"
    )!;
    mode.querySelector<HTMLButtonElement>(`[data-tab-key="${value}"]`)!.click();
  });
};

it("distinguishes pending, error/retry and empty turn without fake statistics", async () => {
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ files: [], complete: false });
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "a",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  expect(host.textContent).toContain("changeReview.loading");
  expect(host.textContent).not.toContain("+—");
  expect(
    host.querySelector(".mobile-change-review")?.getAttribute("aria-busy")
  ).toBe("true");
  expect(
    host.querySelectorAll(
      '.mobile-change-review__loading-row[aria-hidden="true"]'
    )
  ).toHaveLength(2);
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("changeReview.retry");
  expect(host.textContent).toContain("changeReview.loadFailed");
  expect(host.textContent).not.toContain("changeReview.emptyTurn");
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  await act(async () => button("changeReview.retry").click());
  expect(host.textContent).toContain("changeReview.loading");
  expect(host.textContent).not.toContain("changeReview.loadFailed");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.innerHTML).toBe("");
  call.mockResolvedValue({ files: [file], complete: false });
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "a",
        roundId: "two",
        online: true,
        revision: "2",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("changeReview.filesCount");
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  expect(summaryHeading().hasAttribute("disabled")).toBe(false);
});

it("loads only the summary until opened, and never presents a patch as full file", async () => {
  const call = vi.fn().mockImplementation((_method, params) =>
    Promise.resolve({
      complete: false,
      files: [
        {
          ...file,
          patches: params.filePath ? ["@@ -1 +1 @@\n-old\n+new"] : [],
        },
      ],
    })
  );
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "a",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(call).toHaveBeenCalledTimes(1);
  expect(host.querySelector("pre")).toBeNull();
  await act(async () => button("changeReview.filesCount").click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("+new");
  expect(
    host.querySelector(".mobile-patch-diff__line.is-added code")?.textContent
  ).toBe("new");
  expect(call.mock.calls.filter(([, params]) => !params.filePath)).toHaveLength(
    1
  );
  await act(async () => button("close").click());
  await act(async () => button("changeReview.filesCount").click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(call.mock.calls.filter(([, params]) => !params.filePath)).toHaveLength(
    1
  );
  await selectMode("full");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("changeReview.unavailable");
  await selectScope("workspace");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(
    call.mock.calls.some(([, params]) => params.scope === "workspace")
  ).toBe(true);
});

it("shows file rows by default and toggles them with an accessible icon without opening review", async () => {
  const call = vi.fn().mockResolvedValue({
    complete: false,
    files: [file, { ...file, path: "src/second.ts" }],
  });
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "a",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.querySelectorAll(".mobile-change-review__row")).toHaveLength(2);
  expect(summaryHeading().textContent).toContain("changeReview.filesCount (2)");
  expect(summaryHeading().textContent).toContain("+2");
  expect(summaryHeading().textContent).toContain("-2");
  expect(summaryHeading().style.width).toBe("100%");
  expect(summaryHeading().style.height).toBe("auto");
  expect(summaryHeading().style.minHeight).toBe(
    "var(--mobile-change-row-height)"
  );
  const collapse = host.querySelector<HTMLButtonElement>(
    '[aria-label="changeReview.collapse"]'
  )!;
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  expect(collapse.classList.contains("button")).toBe(true);
  expect(collapse.querySelector("svg")).not.toBeNull();
  expect(collapse.querySelector(".truncate")).toBeNull();
  expect(collapse.textContent).toBe("");
  expect(collapse.style.padding).toBe("0px");
  expect(collapse.style.width).toBe("var(--mobile-change-touch-size)");
  const rows = document.getElementById(
    collapse.getAttribute("aria-controls")!
  )!;
  expect(rows.hidden).toBe(false);
  await act(async () => collapse.click());
  expect(rows.hidden).toBe(true);
  expect(host.querySelectorAll(".mobile-change-review__row")).toHaveLength(0);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="changeReview.expand"]')!
      .click()
  );
  expect(host.querySelectorAll(".mobile-change-review__row")).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(1);
});

it("does not fetch when offline and clears pending debounce on unmount", async () => {
  const call = vi.fn();
  const props = {
    client: { call } as unknown as MobileRpcClient,
    sessionId: "a",
    roundId: "one",
    online: false,
    revision: "1",
  };
  await act(async () =>
    root.render(React.createElement(MobileChangeReview, props))
  );
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(call).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "changeReview.offline"
  );
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  expect(host.textContent).not.toContain("changeReview.retry");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, { ...props, online: true })
    )
  );
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(call).not.toHaveBeenCalled();
});

it("explains a failed load and turns repeated retry clicks into one pending request", async () => {
  let finishRetry!: (value: unknown) => void;
  const call = vi
    .fn()
    .mockRejectedValueOnce(new Error("private server failure"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRetry = resolve;
        })
    );
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "retry",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("changeReview.loadFailed");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "changeReview.loadFailed"
  );
  expect(host.textContent).not.toContain("private server failure");
  const retry = button("changeReview.retry");
  expect(retry.classList.contains("button")).toBe(true);
  expect(retry.classList.contains("mobile-change-review__retry")).toBe(true);
  expect(retry.style.height).toBe("var(--mobile-change-touch-size)");
  expect(retry.style.padding).toBe("0 var(--mobile-change-action-padding)");
  expect(retry.querySelector("svg")).not.toBeNull();
  await act(async () => {
    retry.click();
    retry.click();
  });
  expect(host.textContent).toContain("changeReview.loading");
  expect(host.textContent).not.toContain("changeReview.loadFailed");
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  expect(host.querySelectorAll(".mobile-change-review__row")).toHaveLength(0);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(call).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("changeReview.loading");
  await act(async () =>
    finishRetry({ complete: false, files: [{ ...file, path: "recovered.ts" }] })
  );
  expect(summaryHeading()).toBeInstanceOf(HTMLButtonElement);
  expect(summaryHeading().hasAttribute("disabled")).toBe(false);
  expect(host.textContent).toContain("recovered.ts");
  expect(host.textContent).not.toContain("changeReview.retry");
});

it.each(["pending", "error", "offline"] as const)(
  "preserves explicit review opening and scope selection while the turn is %s",
  async (state) => {
    const call = vi.fn().mockImplementation((_method, params) => {
      if (params.scope === "turn") {
        return state === "error"
          ? Promise.reject(new Error("turn load failed"))
          : new Promise(() => {});
      }
      return Promise.resolve({ complete: false, files: [file] });
    });
    await act(async () =>
      root.render(
        React.createElement(MobileChangeReview, {
          client: { call } as unknown as MobileRpcClient,
          sessionId: "alternate-scope",
          roundId: "one",
          online: state !== "offline",
          revision: "1",
        })
      )
    );
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const heading = summaryHeading();
    expect(heading).toBeInstanceOf(HTMLButtonElement);
    expect(heading.hasAttribute("disabled")).toBe(false);
    expect(heading.getAttribute("aria-haspopup")).toBe("dialog");
    expect(heading.style.height).toBe("auto");
    expect(heading.style.minHeight).toBe("var(--mobile-change-row-height)");
    await act(async () => heading.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await selectScope("session");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    if (state === "offline") {
      expect(call).not.toHaveBeenCalled();
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
        "changeReview.offline"
      );
    } else {
      expect(
        call.mock.calls.filter(([, params]) => params.scope === "turn")
      ).toHaveLength(1);
      expect(
        call.mock.calls.some(([, params]) => params.scope === "session")
      ).toBe(true);
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
        "a.ts"
      );
    }
  }
);

it("preserves zero-stat files without making up unknown totals", async () => {
  const call = vi.fn().mockResolvedValue({
    complete: false,
    files: [
      { ...file, path: "unknown.ts", additions: null, deletions: null },
      { ...file, path: "unchanged-count.ts", additions: 0, deletions: 0 },
    ],
  });
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "counts",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(summaryHeading().textContent).toContain("changeReview.filesCount (2)");
  expect(summaryHeading().textContent).not.toContain("+0");
  expect(summaryHeading().textContent).not.toContain("-0");
  const [unknown, known] = host.querySelectorAll(".mobile-change-review__row");
  expect(unknown.textContent).toContain("unknown.ts");
  expect(unknown.textContent).not.toContain("+0");
  expect(unknown.textContent).not.toContain("-0");
  expect(known.textContent).toContain("unchanged-count.ts");
  expect(host.querySelectorAll(".mobile-change-review__row")).toHaveLength(2);
});

it("shows the filename before a compact directory and opens the exact long path", async () => {
  const path =
    "/Users/example/projects/remote-client/src/modules/MobileRemote/components/StatusBadge.test.tsx";
  const call = vi.fn().mockImplementation((_method, params) =>
    Promise.resolve({
      complete: false,
      files: [
        {
          ...file,
          path,
          patches: params.filePath ? ["@@ -1 +1 @@\n-old\n+new"] : [],
        },
      ],
    })
  );
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "long-file",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const row = host.querySelector<HTMLButtonElement>(
    ".mobile-change-review__row"
  )!;
  const pathLabel = row.querySelector<HTMLElement>(
    ".mobile-change-review__path"
  )!;
  expect(
    pathLabel.querySelector(".mobile-change-review__path-filename")?.textContent
  ).toBe("StatusBadge.test.tsx");
  expect(
    pathLabel.querySelector(".mobile-change-review__path-directory")
      ?.textContent
  ).toBe("…/MobileRemote/components");
  expect(pathLabel.textContent).not.toContain("/Users/example");
  expect(pathLabel.title).toBe(path);
  expect(row.dataset.mobileChangePath).toBe(path);
  expect(row.classList.contains("button")).toBe(true);
  expect(row.style.width).toBe("100%");
  expect(row.style.minWidth).toBe("0px");
  expect(row.style.height).toBe("auto");
  expect(row.style.minHeight).toBe("var(--mobile-change-row-height)");
  expect(row.style.padding).toBe("var(--mobile-change-row-padding)");
  expect(row.textContent).toContain("+1");
  expect(row.textContent).toContain("-1");
  await act(async () => row.click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(call.mock.calls.filter(([, params]) => !params.filePath)).toHaveLength(
    1
  );
  expect(call.mock.calls.some(([, params]) => params.filePath === path)).toBe(
    true
  );
});

it("rejects malformed remote data instead of interpreting missing counts as zero", () => {
  expect(() =>
    validateReview({ complete: true, files: [{ ...file, additions: -1 }] })
  ).toThrow();
  expect(() =>
    validateReview({ complete: true, files: [{ ...file, after: {} }] })
  ).toThrow();
  expect(
    validateReview({ complete: false, files: [{ ...file, additions: null }] })
      .files[0].additions
  ).toBeNull();
});

it("ignores a late manifest from the previously selected session", async () => {
  let finishOld!: (value: unknown) => void;
  const call = vi.fn().mockImplementation((_method, params) =>
    params.sessionId === "old"
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve({
          complete: false,
          files: [{ ...file, path: "new.ts" }],
        })
  );
  const props = {
    client: { call } as unknown as MobileRpcClient,
    sessionId: "old",
    roundId: "one",
    online: true,
    revision: "1",
  };
  await act(async () =>
    root.render(React.createElement(MobileChangeReview, props))
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, { ...props, sessionId: "new" })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.textContent).toContain("new.ts");
  await act(async () =>
    finishOld({ complete: false, files: [{ ...file, path: "old.ts" }] })
  );
  expect(host.textContent).toContain("new.ts");
  expect(host.textContent).not.toContain("old.ts");
});

it("labels a before-only historical snapshot instead of implying it is the current file", async () => {
  const call = vi.fn().mockImplementation((_method, params) =>
    Promise.resolve({
      complete: false,
      files: [
        {
          ...file,
          before: params.filePath ? "captured before edit" : null,
          availability: "before_snapshot_only",
        },
      ],
    })
  );
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "a",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => button("changeReview.filesCount").click());
  await selectMode("full");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(host.querySelector("pre")?.textContent).toBe("captured before edit");
  expect(button("changeReview.before").disabled).toBe(true);
  expect(host.textContent).not.toContain("changeReview.after");
});

it("keeps identity compact, details opt-in and icon actions available across detail loading", async () => {
  const namedFile = { ...file, path: "src/features/review/example.ts" };
  let resolveDetail!: (value: unknown) => void;
  const call = vi.fn().mockImplementation((_method, params) =>
    params.filePath
      ? new Promise((resolve) => {
          resolveDetail = resolve;
        })
      : Promise.resolve({ complete: false, files: [namedFile] })
  );
  await act(async () =>
    root.render(
      React.createElement(MobileChangeReview, {
        client: { call } as unknown as MobileRpcClient,
        sessionId: "compact",
        roundId: "one",
        online: true,
        revision: "1",
      })
    )
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => button("changeReview.filesCount").click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const heading = host.querySelector(".mobile-change-review__file-heading")!;
  expect(heading.textContent).toContain("example.ts");
  expect(heading.textContent).toContain("+1");
  expect(heading.textContent).toContain("-1");
  expect(
    heading.querySelector(".mobile-change-review__file-toggle")
  ).not.toBeNull();
  expect(heading.textContent).toContain("src/features");
  const disclosures = [...host.querySelectorAll("details")];
  expect(disclosures).toHaveLength(3);
  expect(disclosures.every((detail) => !detail.open)).toBe(true);
  expect(
    host.querySelector(
      '.mobile-change-review__file [data-state="loading"][role="status"]'
    )
  ).not.toBeNull();
  const copy = host.querySelector<HTMLButtonElement>(
    '[aria-label="changeReview.copy"]'
  )!;
  expect(copy.disabled).toBe(true);
  expect(copy.textContent).toBe("");
  await act(async () =>
    resolveDetail({
      complete: false,
      files: [{ ...namedFile, after: "loaded file" }],
    })
  );
  expect(copy.disabled).toBe(false);
  expect(host.querySelector("pre")?.dataset.wrap).toBe("true");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="changeReview.wrap"]')!
      .click()
  );
  expect(host.querySelector("pre")?.dataset.wrap).toBe("false");
  const requestCount = call.mock.calls.length;
  await act(async () => {
    host.querySelector<HTMLDetailsElement>(
      ".mobile-change-review__file-path"
    )!.open = true;
  });
  expect(
    host.querySelector(".mobile-change-review__file-path")!.textContent
  ).toContain(namedFile.path);
  expect(call).toHaveBeenCalledTimes(requestCount);
});
