// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import { sharedBrowserTabsAtom } from "@src/store/workstation/browser/tabs";

import {
  findBrowserSessionByUrl,
  loadBrowserPillContent,
  waitForPendingPills,
} from "../contextPillContent";

const mocks = vi.hoisted(() => ({
  storeMissing: false,
  invoke: vi.fn(),
  storePillText: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@src/api/http/project", () => ({ projectApi: {} }));
vi.mock("@src/config/pillTokens", () => ({
  storePillText: mocks.storePillText,
  capPillText: vi.fn(),
}));
vi.mock("@src/store/workstation/tabs", () => ({ mainPaneTabsAtom: {} }));
vi.mock("@src/store/workstation/browser/tabs", () => ({
  sharedBrowserTabsAtom: {},
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => {
    if (mocks.storeMissing) throw new Error("Store not initialized.");
    return { get: mocks.get };
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storeMissing = false;
  localStorage.clear();
  mocks.invoke.mockRejectedValue(new Error("Webview not mounted"));
});

it("loads browser mention URLs from the current workstation tab when its webview is unavailable", async () => {
  mocks.get.mockReturnValue([
    {
      type: "browser-session",
      data: { sessionId: "browser-1", url: "https://current.example" },
    },
  ]);
  loadBrowserPillContent("browser-1", "browser://mention");
  await waitForPendingPills();
  expect(mocks.invoke).toHaveBeenCalledWith("get_full_html_document", {
    label: "browser-session-browser-1",
  });
  expect(mocks.storePillText).toHaveBeenCalledWith(
    "browser://mention",
    "URL: https://current.example"
  );
});

it("does not resurrect a closed browser URL from retired global-tab records", async () => {
  localStorage.setItem(
    "orgii-global-tabs",
    JSON.stringify({
      browser: [{ id: "closed", url: "https://stale.example" }],
    })
  );
  mocks.get.mockReturnValue([]);
  loadBrowserPillContent("closed", "browser://closed");
  await waitForPendingPills();
  expect(mocks.storePillText).not.toHaveBeenCalled();
});

it("still loads page text when a browser has no recorded URL", async () => {
  mocks.get.mockReturnValue([]);
  mocks.invoke.mockResolvedValue("<body>Current page</body>");
  const textGetter = vi
    .spyOn(DOMParser.prototype, "parseFromString")
    .mockReturnValue({
      body: { innerText: "Current page" },
    } as Document);
  try {
    loadBrowserPillContent("browser-1", "browser://text");
    await waitForPendingPills();
    expect(mocks.storePillText).toHaveBeenCalledWith(
      "browser://text",
      "Current page"
    );
  } finally {
    textGetter.mockRestore();
  }
});

function browserTab(sessionId: string, url: string, title = "Page") {
  return { type: "browser-session", title, data: { sessionId, url } };
}

it("matches a pasted url to the in-app browser session showing it", () => {
  mocks.get.mockImplementation((atom: unknown) =>
    atom === sharedBrowserTabsAtom
      ? []
      : [browserTab("s1", "https://docs.example/guide", "Guide")]
  );
  expect(findBrowserSessionByUrl("https://docs.example/guide")).toEqual({
    sessionId: "s1",
    title: "Guide",
  });
});

it("treats a trailing slash and a fragment as the same page", () => {
  mocks.get.mockImplementation((atom: unknown) =>
    atom === sharedBrowserTabsAtom
      ? []
      : [browserTab("s1", "https://docs.example/guide/")]
  );
  expect(findBrowserSessionByUrl("https://docs.example/guide#setup")).toEqual(
    expect.objectContaining({ sessionId: "s1" })
  );
});

it("also finds pages held in shared browser tabs", () => {
  mocks.get.mockImplementation((atom: unknown) =>
    atom === sharedBrowserTabsAtom
      ? [browserTab("shared-1", "https://shared.example/")]
      : []
  );
  expect(findBrowserSessionByUrl("https://shared.example")).toEqual(
    expect.objectContaining({ sessionId: "shared-1" })
  );
});

it("does not match a different page, a non-browser tab, or garbage", () => {
  mocks.get.mockImplementation((atom: unknown) =>
    atom === sharedBrowserTabsAtom
      ? []
      : [
          browserTab("s1", "https://docs.example/guide"),
          {
            type: "file",
            title: "x",
            data: { sessionId: "f", url: "https://other.example" },
          },
        ]
  );
  expect(findBrowserSessionByUrl("https://docs.example/other")).toBeNull();
  expect(findBrowserSessionByUrl("https://other.example")).toBeNull();
  expect(findBrowserSessionByUrl("not a url")).toBeNull();
});

it("finds no session, rather than throwing, when the app store is absent", () => {
  mocks.storeMissing = true;
  expect(findBrowserSessionByUrl("https://docs.example/guide")).toBeNull();
});
