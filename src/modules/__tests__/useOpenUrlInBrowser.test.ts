// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { createElement, useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@src/config/routes";
import {
  type SmokeRoot,
  createSmokeRoot,
  dispatch,
} from "@src/test/reactSmokeHarness";
import { openLink } from "@src/util/ui/openLink";

import { useOpenUrlInBrowser } from "../useOpenUrlInBrowser";

const mocks = vi.hoisted(() => ({
  sessions: [] as { id: string; url: string }[],
  handleAddSession: vi.fn(),
  handleSessionClick: vi.fn(),
  messageInfo: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  pathname: "",
}));

vi.mock("@src/contexts/workstation", () => ({
  useBrowserContext: () => ({
    sessions: mocks.sessions,
    handleAddSession: mocks.handleAddSession,
    handleSessionClick: mocks.handleSessionClick,
  }),
}));
vi.mock("@src/components/Message", () => ({
  default: { info: mocks.messageInfo, error: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@src/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function BrowserHost() {
  useOpenUrlInBrowser();
  const { pathname } = useLocation();
  useEffect(() => {
    mocks.pathname = pathname;
  }, [pathname]);
  return null;
}

let root: SmokeRoot | null = null;

async function renderHost() {
  root = createSmokeRoot();
  await root.render(
    createElement(
      Provider,
      { store: createStore() },
      createElement(
        MemoryRouter,
        { initialEntries: ["/orgii/workstation/chat"] },
        createElement(BrowserHost)
      )
    )
  );
}

async function unmountHost() {
  await root?.unmount();
  root = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.sessions = [];
});

// A host left mounted by a failed test would take the next test's links.
afterEach(unmountHost);

describe("useOpenUrlInBrowser", () => {
  it("takes a link in a background tab, so it never reaches the system browser", async () => {
    await renderHost();

    await dispatch(() => openLink("https://example.com/docs"));

    expect(mocks.handleAddSession).toHaveBeenCalledWith(
      "https://example.com/docs"
    );
    expect(mocks.messageInfo).toHaveBeenCalledOnce();
    expect(mocks.pathname).toBe("/orgii/workstation/chat");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("reuses an open tab and brings the Browser into view for a pull request", async () => {
    const url = "https://github.com/org2AI/ORG2/pull/851";
    mocks.sessions = [{ id: "browser-tab-1", url }];
    await renderHost();

    await dispatch(() => openLink(url));

    expect(mocks.handleSessionClick).toHaveBeenCalledWith("browser-tab-1");
    expect(mocks.handleAddSession).not.toHaveBeenCalled();
    expect(mocks.pathname).toBe(ROUTES.workStation.browser.path);
    expect(mocks.messageInfo).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("stops taking links once unmounted, so they go to the system browser", async () => {
    await renderHost();
    await unmountHost();

    openLink("https://example.com/docs");

    expect(mocks.handleAddSession).not.toHaveBeenCalled();
    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });
});
