// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WeeklyQuotaHistoryPanel from "./WeeklyQuotaHistoryPanel";

const mocks = vi.hoisted(() => ({
  state: {
    accounts: [] as unknown[],
    loading: false,
    error: false,
    observedAt: 10000,
    refresh: vi.fn(),
  },
}));
vi.mock("@src/hooks/keyVault/useWeeklyQuotaHistory", () => ({
  useWeeklyQuotaHistory: () => mocks.state,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts: { defaultValue?: string }) => opts?.defaultValue,
    i18n: { language: "en" },
  }),
}));
vi.mock("./RuntimeSectionHeader", () => ({
  RuntimeSectionHeader: ({
    title,
    children,
  }: {
    title: string;
    children: unknown;
  }) => createElement("div", null, title, children as never),
  RuntimeRefreshButton: ({ onRefresh }: { onRefresh: () => void }) =>
    createElement("button", { onClick: onRefresh }, "Read history"),
}));
vi.mock("@src/components/Chart", () => ({
  CHART_AXIS_TICK: {},
  CHART_GRID_STROKE: "currentColor",
  CHART_MARGIN: {},
  CHART_TOOLTIP: {},
}));
vi.mock("@src/components/Select", () => ({
  default: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) =>
    createElement(
      "select",
      {
        onChange: (event: { target: { value: string } }) =>
          onChange(event.target.value),
      },
      options.map((o) =>
        createElement("option", { value: o.value, key: o.value }, o.label)
      )
    ),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: unknown }) => children,
  BarChart: ({ children }: { children: unknown }) =>
    createElement("div", { "data-testid": "quota-chart" }, children as never),
  Bar: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  mocks.state.accounts = [];
  mocks.state.error = false;
  vi.unstubAllGlobals();
});
async function mount() {
  const element = document.createElement("div");
  const root = createRoot(element);
  roots.push(root);
  await act(async () => root.render(createElement(WeeklyQuotaHistoryPanel)));
  return element;
}
const account = (index: number) => ({
  keyId: String(index),
  name: `Account ${index}`,
  provider: "codex",
  status: "ok",
  points: [{ capturedAt: 10000, remainingPercent: 80, resetAt: null }],
});
describe("WeeklyQuotaHistoryPanel", () => {
  it("mounts only the selected account chart for a 128-account history", async () => {
    mocks.state.accounts = Array.from({ length: 128 }, (_, i) => account(i));
    const element = await mount();
    expect(
      element.querySelectorAll('[data-testid="quota-chart"]')
    ).toHaveLength(1);
    const select = element.querySelector("select")!;
    await act(async () => {
      select.value = "127";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      element.querySelectorAll('[data-testid="quota-chart"]')
    ).toHaveLength(1);
    expect(element.textContent).toContain("Account 127");
  });
  it("does not mistake a failed load for a disconnected account list", async () => {
    mocks.state.error = true;
    const element = await mount();
    expect(element.textContent).toContain("unavailable");
    expect(element.textContent).not.toContain("Connect a Claude Code");
  });
});
