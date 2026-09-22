/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import SettingsTable, {
  SETTINGS_TABLE_FILTER_MIN_WIDTH,
  type SettingsTableSelectFilter,
} from "./index";

interface Row {
  id: string;
}

const roots: Array<ReturnType<typeof createSmokeRoot>> = [];

async function mount(
  filters: SettingsTableSelectFilter[],
  inlineHeaderToolbar = false
): Promise<HTMLElement> {
  const root = createSmokeRoot();
  roots.push(root);
  await root.render(
    React.createElement(SettingsTable<Row>, {
      columns: [{ key: "id", label: "Id", renderCell: (row: Row) => row.id }],
      rows: [{ id: "a" }],
      getRowKey: (row: Row) => row.id,
      selectFilters: filters,
      inlineHeaderToolbar,
    })
  );
  return root.container;
}

async function mountWithCardView(
  filters: SettingsTableSelectFilter[],
  onEnabledChange: (enabled: boolean) => void
): Promise<HTMLElement> {
  const root = createSmokeRoot();
  roots.push(root);
  await root.render(
    React.createElement(SettingsTable<Row>, {
      columns: [{ key: "id", label: "Id", renderCell: (row: Row) => row.id }],
      rows: [{ id: "a" }],
      getRowKey: (row: Row) => row.id,
      selectFilters: filters,
      cardView: { enabled: false, onEnabledChange },
    })
  );
  return root.container;
}

function resetButton(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    "[data-testid='settings-table-reset-filters']"
  );
}

function buildFilters(values: { provider: string; status: string }): {
  filters: SettingsTableSelectFilter[];
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  return {
    onChange,
    filters: [
      {
        key: "provider",
        value: values.provider,
        defaultValue: "all",
        options: [
          { value: "all", label: "All providers" },
          { value: "openai", label: "OpenAI" },
        ],
        onChange: (value) => onChange("provider", value),
      },
      {
        key: "status",
        value: values.status,
        defaultValue: "all",
        options: [
          { value: "all", label: "All" },
          { value: "enabled", label: "Enabled" },
        ],
        onChange: (value) => onChange("status", value),
      },
    ],
  };
}

afterEach(async () => {
  while (roots.length > 0) await roots.pop()?.unmount();
});

describe("SettingsTable filter row", () => {
  it("offers no reset while every filter sits at its default", async () => {
    const { filters } = buildFilters({ provider: "all", status: "all" });
    expect(resetButton(await mount(filters))).toBeNull();
  });

  it("resets only the filters that actually moved", async () => {
    const { filters, onChange } = buildFilters({
      provider: "openai",
      status: "all",
    });
    const container = await mount(filters);

    resetButton(container)!.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("provider", "all");
  });

  it("offers the reset in the inline toolbar layout too", async () => {
    const { filters, onChange } = buildFilters({
      provider: "openai",
      status: "enabled",
    });
    const container = await mount(filters, true);

    resetButton(container)!.click();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith("provider", "all");
    expect(onChange).toHaveBeenCalledWith("status", "all");
  });

  it("offers the card-view toggle only when a table can switch modes", async () => {
    const { filters } = buildFilters({ provider: "all", status: "all" });

    const withoutToggle = await mount(filters);
    expect(
      withoutToggle.querySelector("[data-testid='settings-table-view-toggle']")
    ).toBeNull();

    const onEnabledChange = vi.fn();
    const withToggle = await mountWithCardView(filters, onEnabledChange);
    const toggle = withToggle.querySelector<HTMLElement>(
      "[data-testid='settings-table-view-toggle']"
    );
    expect(toggle).not.toBeNull();

    toggle!.click();
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("grows a toolbar for the toggle when the table has none", async () => {
    const root = createSmokeRoot();
    roots.push(root);
    await root.render(
      React.createElement(SettingsTable<Row>, {
        columns: [{ key: "id", label: "Id", renderCell: (row: Row) => row.id }],
        rows: [{ id: "a" }],
        getRowKey: (row: Row) => row.id,
        cardView: { enabled: true, onEnabledChange: vi.fn() },
      })
    );

    expect(
      root.container.querySelector("[data-testid='settings-table-view-toggle']")
    ).not.toBeNull();
  });

  it("keeps option icons in the dropdown, not on the closed trigger", async () => {
    const onChange = vi.fn();
    const container = await mount([
      {
        key: "provider",
        value: "openai",
        defaultValue: "all",
        options: [
          { value: "all", label: "All providers" },
          {
            value: "openai",
            label: "OpenAI",
            icon: React.createElement("svg", { "data-icon": "openai" }),
          },
        ],
        onChange: (value) => onChange("provider", value),
      },
    ]);

    // The trigger shows the label only; the mark belongs to the option row.
    expect(container.querySelector("[data-icon='openai']")).toBeNull();
  });

  it("gives filter dropdowns room for provider names and their icons", async () => {
    const { filters } = buildFilters({ provider: "all", status: "all" });
    const container = await mount(filters);

    expect(SETTINGS_TABLE_FILTER_MIN_WIDTH).toBeGreaterThanOrEqual(180);
    expect(container.querySelectorAll(".select-wrapper").length).toBe(2);
  });
});
