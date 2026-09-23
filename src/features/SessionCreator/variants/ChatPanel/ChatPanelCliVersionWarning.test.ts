// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvailableAgent } from "@src/config/cliAgents/types";
import zh from "@src/i18n/locales/zh/sessions.json";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";

import { ChatPanelCliVersionWarning } from "./ChatPanelCliVersionWarning";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  focus: vi.fn(),
  setActive: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock("@src/services/terminal/TerminalService", () => ({
  TerminalService: {
    executeInNewSession: mocks.execute,
    focus: mocks.focus,
    setActive: mocks.setActive,
  },
}));
vi.mock("@src/util/ui/openLink", () => ({ openLink: mocks.openLink }));
vi.mock("@src/components/Message", () => ({
  default: { info: mocks.info, error: mocks.error },
}));
vi.mock("@src/store/workstation/codeEditor/terminal", async () => {
  const { atom } = await import("jotai");
  return { terminalSessionsAtom: atom([{ id: "upgrade-terminal" }]) };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const label =
        zh.creator.cliVersionOutdated[
          key.split(".").at(-1) as keyof typeof zh.creator.cliVersionOutdated
        ] ?? key;
      return label.replace(
        /{{(\w+)}}/g,
        (_, name: string) => values[name] ?? ""
      );
    },
  }),
}));

describe("CLI upgrade notice", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;
  const onRefresh = vi.fn();
  const agents: Record<string, AvailableAgent> = Object.fromEntries(
    [
      [
        "cursor_cli",
        "Cursor",
        [{ id: "self", label: "", command: "cursor-agent update" }],
      ],
      [
        "codex",
        "Codex",
        [
          {
            id: "npm",
            label: "npm",
            command: "npm install -g @openai/codex@latest",
          },
          {
            id: "homebrew",
            label: "Homebrew",
            command: "brew upgrade --cask codex",
          },
        ],
      ],
      [
        "opencode",
        "OpenCode",
        [{ id: "self", label: "", command: "opencode upgrade" }],
      ],
      ["trae_cli", "Trae Agent", []],
    ].map(([name, displayName, upgradeMethods]) => [
      name,
      {
        name,
        displayName,
        upgradeMethods,
        docsUrl: `https://example.com/${name}`,
        installed: true,
        hasKeys: true,
        description: "",
        brandColor: "",
        hasSubscriptionPlan: false,
        nativeSubscriptionLabels: [],
        compatibleApiProviders: [],
        supportedProtocols: [],
        configFiles: [],
        installMethods: [],
        uninstallMethods: [],
        isComplexSetup: false,
        supportedSetupMethods: [],
        popular: false,
        iconProvider: "",
        command: name,
        supportsRustAgents: true,
        acpSupport: "unavailable",
        supportsOrgiiPool: false,
        supportsGui: true,
      },
    ])
  ) as Record<string, AvailableAgent>;
  const render = (cliAgentType = "cursor_cli", visible = true, copies = 1) =>
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          visible &&
            Array.from({ length: copies }, (_, key) =>
              React.createElement(ChatPanelCliVersionWarning, {
                key,
                cliVersionAlert: {
                  cliAgent: agents[cliAgentType],
                  cliDisplayName: agents[cliAgentType].displayName,
                  installedVersion: "2026.09.10-fd3934a",
                  latestVersion: "2026.09.18-9a7762b",
                  refreshing: false,
                  onRefresh,
                  onClose: vi.fn(),
                  onMuteUntilNextVersion: vi.fn(),
                },
              })
            )
        )
      );
    });
  const upgrade = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="session-creator-cli-version-upgrade"]'
    )!;
  const chooseMethod = async (id: string) => {
    await act(async () => upgrade().click());
    expect(document.body.textContent).toContain("选择原来的安装方式");
    const option = document.querySelector<HTMLButtonElement>(
      `[data-testid="cli-upgrade-method-${id}"]`
    );
    expect(option).not.toBeNull();
    await act(async () => option!.click());
  };
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = createStore();
    mocks.execute.mockResolvedValue("upgrade-terminal");
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("explains versions, offers Cursor upgrade, and preserves recheck", async () => {
    render();
    expect(container.textContent).toContain("Cursor 有新版本");
    expect(container.textContent).toContain("当前版本：2026.09.10-fd3934a");
    expect(container.textContent).toContain("最新版本：2026.09.18-9a7762b");
    expect(container.querySelector('[aria-label="actions.copy"]')).toBeNull();
    expect(upgrade().textContent).toBe("在终端升级");
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledWith("cursor-agent update", {
      name: "升级 Cursor 命令行工具",
    });
    expect(mocks.info).toHaveBeenCalledWith(
      "已在终端启动升级，完成后点击重新检查"
    );
    expect(onRefresh).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="session-creator-cli-version-refresh"]'
        )!
        .click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent notices and remounts, then focuses the same terminal", async () => {
    let finish!: (id: string) => void;
    mocks.execute.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    render("cursor_cli", true, 2);
    act(() => {
      container
        .querySelectorAll<HTMLButtonElement>(
          '[data-testid="session-creator-cli-version-upgrade"]'
        )
        .forEach((button) => button.click());
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(upgrade().disabled).toBe(true);
    render("cursor_cli", false);
    render();
    expect(upgrade().disabled).toBe(true);
    await act(async () => finish("upgrade-terminal"));
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.setActive).toHaveBeenCalledWith("upgrade-terminal");
    expect(mocks.focus).toHaveBeenCalledOnce();
  });

  it("allows retry after launch failure and after the old terminal is closed", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("not ready"));
    render();
    await act(async () => upgrade().click());
    expect(mocks.error).toHaveBeenCalledWith("无法打开升级终端，请重试");
    expect(upgrade().disabled).toBe(false);
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    act(() => store.set(terminalSessionsAtom, []));
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("isolates simultaneous CLI upgrades and late completions", async () => {
    let finish!: (id: string) => void;
    mocks.execute.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    render();
    act(() => upgrade().click());
    render("codex");
    expect(upgrade().disabled).toBe(false);
    mocks.execute.mockResolvedValueOnce("codex-terminal");
    await chooseMethod("npm");
    expect(mocks.execute).toHaveBeenLastCalledWith(
      "npm install -g @openai/codex@latest",
      {
        name: "升级 Codex 命令行工具",
      }
    );
    await act(async () => finish("upgrade-terminal"));
    expect(container.textContent).toContain("Codex 有新版本");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    render("cursor_cli", false);
    expect(container.textContent).toBe("");
  });

  it("lets users choose Homebrew without changing package managers", async () => {
    render("codex");
    expect(mocks.execute).not.toHaveBeenCalled();
    await chooseMethod("homebrew");
    expect(mocks.execute).toHaveBeenCalledWith("brew upgrade --cask codex", {
      name: "升级 Codex 命令行工具",
    });
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.focus).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[data-testid="cli-upgrade-method-npm"]')
    ).toBeNull();
  });

  it("uses OpenCode's own updater", async () => {
    render("opencode");
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledWith("opencode upgrade", {
      name: "升级 OpenCode 命令行工具",
    });
  });

  it("offers documentation when no safe command is available", async () => {
    render("trae_cli");
    expect(upgrade()).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="session-creator-cli-upgrade-docs"]'
        )!
        .click()
    );
    expect(mocks.openLink).toHaveBeenCalledWith("https://example.com/trae_cli");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps separate app stores independent", async () => {
    render();
    await act(async () => upgrade().click());
    render("cursor_cli", false);
    store = createStore();
    render();
    await act(async () => upgrade().click());
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
