// @vitest-environment jsdom
import { type SVGProps, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarSessionOpenInApp } from "./SidebarSessionOpenInApp";

const mocks = vi.hoisted(() => ({
  owner: "cliagent-current-episode" as string | null,
  binding: vi.fn(),
  plan: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@src/engines/ChatPanel/hooks/useConversationTargetBinding", () => ({
  useConversationTargetBinding: (id: string) => {
    mocks.binding(id);
    return { appOpenSessionId: mocks.owner };
  },
}));
vi.mock("@src/api/tauri/externalHistory/appOpen", () => ({
  externalHistoryAppOpenPlan: mocks.plan,
  externalHistoryOpenInApp: mocks.open,
}));
vi.mock("@src/assets/modelIcons/claude.svg?url", () => ({
  default: "/fixtures/claude.svg",
}));
vi.mock("@src/assets/modelIcons/openai.svg", () => ({
  default: (props: SVGProps<SVGSVGElement>) => createElement("svg", props),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { app?: string }) =>
      key === "collaboration.openInApp.headerButton"
        ? `Open in ${options?.app}`
        : key,
  }),
}));

describe("sidebar native-app action", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    mocks.owner = "cliagent-current-episode";
    mocks.open.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  const render = () =>
    act(async () =>
      root.render(
        createElement(SidebarSessionOpenInApp, {
          sessionId: "imported-root",
          onClose: mocks.close,
        })
      )
    );

  it.each(["Codex", "Claude"])(
    "opens the canonical episode in %s using the header's action",
    async (app) => {
      mocks.plan.mockResolvedValue({
        source: app === "Claude" ? "claude_code" : "codex_app",
        appDisplayName: app,
        deepLink: `${app.toLowerCase()}://test`,
        nativeSessionId: "native",
        sourceAvailable: true,
      });
      await render();
      expect(mocks.binding).toHaveBeenCalledWith("imported-root");
      expect(mocks.plan).toHaveBeenCalledExactlyOnceWith(
        "cliagent-current-episode"
      );
      const row = container.querySelector<HTMLElement>(
        '[data-testid="session-open-in-app-menu-item"]'
      )!;
      expect(row.textContent).toBe(`Open in ${app}`);
      expect(
        row.querySelector(
          `[data-icon="${app === "Claude" ? "claude" : "codex"}"]`
        )
      ).not.toBeNull();
      expect(row.querySelector('[data-icon="arrow-up-right"]')).not.toBeNull();
      await act(async () => row.click());
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
        "cliagent-current-episode"
      );
      expect(mocks.close).toHaveBeenCalledOnce();
    }
  );

  it("does not fall back to the imported root without a canonical native episode", async () => {
    mocks.owner = null;
    await render();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("retains the source-missing disabled behavior", async () => {
    mocks.plan.mockResolvedValue({
      source: "codex_app",
      appDisplayName: "Codex",
      deepLink: "codex://test",
      nativeSessionId: "native",
      sourceAvailable: false,
    });
    await render();
    const row = container.querySelector<HTMLElement>(
      '[data-testid="session-open-in-app-menu-item"]'
    )!;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    await act(async () => row.click());
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
