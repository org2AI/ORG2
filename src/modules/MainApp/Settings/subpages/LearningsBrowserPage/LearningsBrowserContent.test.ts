// @vitest-environment jsdom
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { LearningRecord } from "@src/api/tauri/rpc/schemas/learning";
import type {
  SettingsTableColumn,
  SettingsTableSelectFilter,
} from "@src/components/SettingsTable";

import { LearningsBrowserContent } from "./LearningsBrowserContent";

const state = vi.hoisted(() => ({
  items: [] as LearningRecord[],
  error: null as string | null,
  setStatus: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  setFilters: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/hooks/settings", () => ({
  useLearningsBrowser: () => ({ ...state, loading: false, filters: {} }),
}));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@src/components/Button", () => ({
  default: ({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title?: string;
    children?: ReactNode;
  }) => createElement("button", { onClick, title }, children),
}));
vi.mock("@src/components/Placeholder", () => ({
  Placeholder: ({ onRetry }: { onRetry: () => void }) =>
    createElement("button", { onClick: onRetry }, "retry"),
}));
vi.mock("@src/components/SettingsTable", () => ({
  default: ({
    rows,
    columns,
    selectFilters,
  }: {
    rows: LearningRecord[];
    columns: SettingsTableColumn<LearningRecord>[];
    selectFilters: SettingsTableSelectFilter[];
  }) =>
    createElement(
      "div",
      null,
      createElement("header", null, columns.map(({ key }) => key).join(",")),
      ...selectFilters.map((filter) =>
        createElement(
          "button",
          { key: filter.key, onClick: () => filter.onChange("active") },
          filter.key
        )
      ),
      ...rows.map((row) =>
        createElement(
          "article",
          { key: row.id, "data-id": row.id },
          ...columns.map((column) =>
            createElement("div", { key: column.key }, column.renderCell(row))
          )
        )
      )
    ),
  SettingsTableLoadMoreFooter: () => null,
}));

it("preserves Evolution columns, filters, actionable rows, mutations and retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.items = (
    ["pending", "active", "deprecated", "merged", "abandoned"] as const
  ).map((status) => ({
    id: status,
    status,
    content: status,
    takeaway: status,
    category: "pattern",
    importance: 1,
    confidence: 1,
    source: "reflection",
    reinforcement_count: 0,
    content_hash: null,
    account_id: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    agent_scope: "agent-a",
    last_recalled_at: null,
    parent_id: null,
  }));
  state.error = null;
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(LearningsBrowserContent)));
    expect(host.querySelector("header")?.textContent).toBe(
      "takeaway,agent,category,status,updated,actions"
    );
    expect(
      [...host.querySelectorAll("article")].map((node) =>
        node.getAttribute("data-id")
      )
    ).toEqual(["pending", "active", "deprecated"]);
    const buttons = [...host.querySelectorAll("button")];
    act(() => buttons.find((node) => node.textContent === "status")!.click());
    expect(state.setFilters).toHaveBeenCalledWith({ status: "active" });
    for (const [label, id, next] of [
      ["promote", "pending", "active"],
      ["deprecate", "active", "deprecated"],
      ["reactivate", "deprecated", "active"],
    ]) {
      await act(async () =>
        buttons
          .find(
            (node) => node.textContent === `learningsBrowser.actions.${label}`
          )!
          .click()
      );
      expect(state.setStatus).toHaveBeenCalledWith(id, next);
    }
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[data-id="pending"] button[title="learningsBrowser.actions.delete"]'
        )!
        .click()
    );
    expect(state.remove).toHaveBeenCalledWith("pending");
    state.error = "offline";
    await act(async () => root.render(createElement(LearningsBrowserContent)));
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(state.refresh).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
