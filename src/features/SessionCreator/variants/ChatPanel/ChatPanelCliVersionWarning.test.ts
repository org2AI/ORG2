// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import zh from "@src/i18n/locales/zh/sessions.json";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";

import { ChatPanelCliVersionWarning } from "./ChatPanelCliVersionWarning";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  focus: vi.fn(),
  setActive: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@src/services/terminal/TerminalService", () => ({
  TerminalService: {
    executeInNewSession: mocks.execute,
    focus: mocks.focus,
    setActive: mocks.setActive,
  },
}));
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
                  cliAgentType,
                  cliDisplayName: "Cursor",
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

  it("does not offer or dispatch Cursor upgrades for another CLI, including late completion", async () => {
    let finish!: (id: string) => void;
    mocks.execute.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    render();
    act(() => upgrade().click());
    render("codex");
    await act(async () => finish("upgrade-terminal"));
    expect(upgrade()).toBeNull();
    expect(mocks.execute).toHaveBeenCalledOnce();
    render("cursor_cli", false);
    expect(container.textContent).toBe("");
  });
});
