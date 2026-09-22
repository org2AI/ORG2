// @vitest-environment jsdom
import { Provider } from "jotai";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@src/config/routes";
import { createBrowserSessionTab } from "@src/store/workstation/browser/tabs";
import {
  createStartTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import {
  type SmokeRoot,
  createSmokeRoot,
  dispatch,
} from "@src/test/reactSmokeHarness";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";
import { openLink } from "@src/util/ui/openLink";

import { useOpenUrlInBrowser } from "../useOpenUrlInBrowser";

const mocks = vi.hoisted(() => ({
  sessions: [] as { id: string; url: string }[],
  handleAddSession: vi.fn(() => "browser-tab-new"),
  handleSessionClick: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  revealMyStation: vi.fn(),
}));

vi.mock("@src/contexts/workstation", () => ({
  useBrowserContext: () => ({
    sessions: mocks.sessions,
    handleAddSession: mocks.handleAddSession,
    handleSessionClick: mocks.handleSessionClick,
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@src/util/ui/revealMyStation", () => ({
  revealMyStation: mocks.revealMyStation,
}));

function BrowserHost() {
  useOpenUrlInBrowser();
  return null;
}

let root: SmokeRoot | null = null;

async function renderHost() {
  const store = createInstrumentedStore();
  root = createSmokeRoot();
  await root.render(
    createElement(
      Provider,
      { store },
      createElement(
        MemoryRouter,
        { initialEntries: ["/orgii/workstation/chat"] },
        createElement(BrowserHost)
      )
    )
  );
  return store;
}

async function unmountHost() {
  await root?.unmount();
  root = null;
  resetInstrumentedStore();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetInstrumentedStore();
  mocks.sessions = [];
});

// A host left mounted by a failed test would take the next test's links.
afterEach(unmountHost);

describe("useOpenUrlInBrowser", () => {
  it("opens a link in the Browser and brings My Station on screen", async () => {
    await renderHost();

    await dispatch(() => openLink("https://example.com/docs"));

    expect(mocks.handleAddSession).toHaveBeenCalledWith(
      "https://example.com/docs"
    );
    expect(mocks.revealMyStation).toHaveBeenCalledWith({
      path: ROUTES.workStation.browser.path,
    });
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("reuses the tab already showing that address and makes it the active tab", async () => {
    const url = "https://github.com/org2AI/ORG2/pull/851";
    mocks.sessions = [{ id: "browser-tab-1", url }];
    const store = await renderHost();
    const launchpad = createStartTab();
    store.set(workstationLayoutAtom, {
      mainPane: {
        tabs: [launchpad, createBrowserSessionTab("browser-tab-1", "GitHub")],
        activeTabId: launchpad.id,
      },
    });

    await dispatch(() => openLink(url));

    expect(mocks.handleSessionClick).toHaveBeenCalledWith("browser-tab-1");
    expect(mocks.handleAddSession).not.toHaveBeenCalled();
    expect(store.get(workstationLayoutAtom).mainPane.activeTabId).toBe(
      "browser:browser-tab-1"
    );
    expect(mocks.revealMyStation).toHaveBeenCalledOnce();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("stops taking links once unmounted, so they go to the system browser", async () => {
    await renderHost();
    await unmountHost();

    openLink("https://example.com/docs");

    expect(mocks.handleAddSession).not.toHaveBeenCalled();
    expect(mocks.revealMyStation).not.toHaveBeenCalled();
    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });
});
