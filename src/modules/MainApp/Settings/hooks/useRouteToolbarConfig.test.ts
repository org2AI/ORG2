// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIZARD_IDS,
  buildAgentOrgsPath,
  buildIntegrationsPath,
  buildSettingsPath,
  buildWizardPath,
} from "@src/config/mainAppPaths";
import { integrationsToolbarAtom } from "@src/store/ui/integrationsToolbarAtom";
import type {
  RouteToolbarButton,
  RouteToolbarConfig,
} from "@src/store/ui/routeToolbarAtom";

import { useRouteToolbarConfig } from "./useRouteToolbarConfig";

const mocks = vi.hoisted(() => ({
  pathname: "",
  navigate: vi.fn(),
  notice: null as RouteToolbarButton | null,
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./useSettingsRegionNoticeButton", () => ({
  useSettingsRegionNoticeButton: () => mocks.notice,
}));

function readToolbar(store = createStore()): RouteToolbarConfig | null {
  let toolbar: RouteToolbarConfig | null = null;
  function Probe() {
    const config = useRouteToolbarConfig();
    useEffect(() => {
      toolbar = config;
    }, [config]);
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Provider, { store }, createElement(Probe)));
  });
  act(() => {
    root.unmount();
  });
  return toolbar;
}

describe("useRouteToolbarConfig", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.navigate.mockReset();
    mocks.notice = null;
    mocks.pathname = buildSettingsPath({ section: "general" });
  });

  it("keeps app settings empty unless a region notice is present", () => {
    expect(readToolbar()).toEqual({ extraButtons: undefined });
    mocks.notice = { id: "region", onClick: vi.fn() };
    expect(readToolbar()?.extraButtons).toEqual([mocks.notice]);
  });

  it("preserves integration actions and scopes them to integration routes", () => {
    const store = createStore();
    const action = { id: "integration-action", onClick: vi.fn() };
    store.set(integrationsToolbarAtom, { extraButtons: [action] });
    mocks.notice = { id: "region", onClick: vi.fn() };
    mocks.pathname = buildIntegrationsPath({ category: "models" });
    expect(readToolbar(store)?.extraButtons).toEqual([mocks.notice, action]);
    mocks.pathname = buildSettingsPath({ section: "appearance" });
    expect(readToolbar(store)?.extraButtons).toEqual([mocks.notice]);
  });

  it("preserves both Agent Teams add actions", () => {
    mocks.pathname = buildAgentOrgsPath({ tab: "agents" });
    const items = readToolbar()?.plusDropdownItems;
    expect(items?.map(({ id }) => id)).toEqual(["add-agent", "add-org"]);
    items?.[0].onClick();
    items?.[1].onClick();
    expect(mocks.navigate.mock.calls).toEqual([
      [buildWizardPath(mocks.pathname, WIZARD_IDS.AGENT_ADD)],
      [buildWizardPath(mocks.pathname, WIZARD_IDS.ORG_ADD)],
    ]);
  });

  it("has no toolbar outside settings", () => {
    mocks.pathname = "/orgii/workstation";
    expect(readToolbar()).toBeNull();
  });
});
