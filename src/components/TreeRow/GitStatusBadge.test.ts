// @vitest-environment jsdom
import { createInstance } from "i18next";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@src/i18n/locales/en/common.json";
import zh from "@src/i18n/locales/zh/common.json";

import GitStatusBadge from "./GitStatusBadge";
import type { GitStatusBadgeProps } from "./types";

const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

async function renderBadge(lng: string, props: GitStatusBadgeProps) {
  const i18n = createInstance();
  await i18n.init({
    lng,
    resources: { en: { common: en }, zh: { common: zh } },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  act(() => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(GitStatusBadge, props)
      )
    );
  });
  return host.firstElementChild!;
}

function hover(trigger: Element) {
  act(() =>
    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  );
}

const tooltip = () =>
  document.body.querySelector(".native-tooltip-content-inner");

describe("source control GitStatusBadge tooltips", () => {
  it.each([
    ["en", "Modified"],
    ["zh", "已修改"],
  ])("shows the %s label after exactly 500 ms", async (lng, label) => {
    const trigger = await renderBadge(lng, {
      status: { status: "modified", staged: false },
      isDirectory: false,
    });
    expect(host.textContent).toBe("M");
    expect(host.querySelector("[title]")).toBeNull();
    hover(trigger);
    act(() => vi.advanceTimersByTime(499));
    expect(tooltip()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(tooltip()?.textContent).toBe(label);
  });

  it("cancels the tooltip when the pointer leaves before 500 ms", async () => {
    const trigger = await renderBadge("en", {
      status: { status: "modified", staged: false },
      isDirectory: false,
    });
    hover(trigger);
    act(() => vi.advanceTimersByTime(250));
    act(() =>
      trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    );
    act(() => vi.advanceTimersByTime(500));
    expect(tooltip()).toBeNull();
  });

  it.each([
    [false, "已新增（已暂存）"],
    [true, "包含文件：已新增"],
  ])(
    "localizes staged files and directory dots (%s)",
    async (isDirectory, label) => {
      const trigger = await renderBadge("zh", {
        status: { status: "added", staged: true },
        isDirectory,
      });
      hover(trigger);
      act(() => vi.advanceTimersByTime(500));
      expect(tooltip()?.textContent).toBe(label);
    }
  );
});
