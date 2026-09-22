/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import {
  SettingsTableCardGrid,
  resolveCardColumnCount,
  resolveCardFieldLines,
} from "./SettingsTableCardGrid";
import type { SettingsTableCardViewConfig, SettingsTableColumn } from "./types";

interface Row {
  id: string;
  name: string;
  sources: string;
}

const ROWS: Row[] = [
  { id: "gpt", name: "GPT 6 Astra", sources: "1/1" },
  { id: "glm", name: "GLM 5.2", sources: "1/2" },
];

const COLUMNS: SettingsTableColumn<Row>[] = [
  {
    key: "model",
    label: "Model",
    renderCell: (row) => React.createElement("span", null, row.name),
  },
  {
    key: "sources",
    label: "Enabled Sources",
    renderCell: (row) => React.createElement("span", null, row.sources),
  },
  {
    key: "status",
    label: "Status",
    renderCell: (row) =>
      React.createElement("button", { type: "button" }, `toggle-${row.id}`),
  },
];

const EXPAND_LABELS = { expand: "Expand", collapse: "Collapse" };

function renderGrid(
  cardView: SettingsTableCardViewConfig<Row>,
  overrides: Partial<
    React.ComponentProps<typeof SettingsTableCardGrid<Row>>
  > = {}
): string {
  return renderToStaticMarkup(
    React.createElement(SettingsTableCardGrid<Row>, {
      cardView,
      columns: COLUMNS,
      rows: ROWS,
      getRowKey: (row) => row.id,
      expandLabels: EXPAND_LABELS,
      ...overrides,
    })
  );
}

describe("SettingsTableCardGrid", () => {
  it("maps columns onto heading, action, and labelled field slots", () => {
    const markup = renderGrid({
      enabled: true,
      titleColumnKey: "model",
      actionColumnKeys: ["status"],
    });

    // Heading and its trailing action share one row; the remaining column
    // becomes a labelled field below it.
    expect(markup).toContain("GPT 6 Astra");
    expect(markup).toContain("toggle-gpt");
    expect(markup).toContain("Enabled Sources");
    expect(markup).toContain("1/1");
    // The action column's own label never renders — the control speaks for it.
    expect(markup).not.toContain(">Status<");
    // The title column's label is not repeated as a field label either.
    expect(markup).not.toContain(">Model<");
  });

  it("drops omitted columns and field labels on request", () => {
    const markup = renderGrid({
      enabled: true,
      titleColumnKey: "model",
      actionColumnKeys: ["status"],
      omitColumnKeys: ["sources"],
      showFieldLabels: false,
    });

    expect(markup).not.toContain("Enabled Sources");
    expect(markup).not.toContain("1/1");
    expect(markup).toContain("GPT 6 Astra");
  });

  it("puts grouped field columns on one card line", () => {
    const columns: SettingsTableColumn<Row>[] = [
      COLUMNS[0],
      COLUMNS[1],
      {
        key: "subagents",
        label: "Subagents",
        renderCell: () => React.createElement("span", null, "7"),
      },
    ];
    const lines = resolveCardFieldLines(columns.slice(1), [
      ["sources", "subagents"],
    ]);

    // Both counts share one line, in the group's declared order; nothing else
    // is folded into it.
    expect(lines).toHaveLength(1);
    expect(lines[0].map((column) => column.key)).toEqual([
      "sources",
      "subagents",
    ]);
    // Ungrouped columns keep a line each.
    expect(
      resolveCardFieldLines(columns, [["sources", "subagents"]]).map((line) =>
        line.map((column) => column.key)
      )
    ).toEqual([["model"], ["sources", "subagents"]]);

    const markup = renderToStaticMarkup(
      React.createElement(SettingsTableCardGrid<Row>, {
        cardView: {
          enabled: true,
          titleColumnKey: "model",
          actionColumnKeys: ["status"],
          fieldLayout: "inline",
          fieldRowGroups: [["sources", "subagents"]],
        },
        columns,
        rows: ROWS,
        getRowKey: (row) => row.id,
        expandLabels: EXPAND_LABELS,
      })
    );

    // One field line holds both labels, divided once, rather than a line per
    // count.
    const [firstCard] = markup.split("GLM 5.2");
    expect(firstCard).toContain("Enabled Sources");
    expect(firstCard).toContain("Subagents");
    expect(
      (firstCard.match(/h-3 w-px shrink-0 bg-border-2/g) ?? []).length
    ).toBe(1);
  });

  it("sizes the grid by auto-fill minimum width or a fixed column count", () => {
    // Unmeasured (server render): auto-fill, since there is no laid-out grid
    // for a derived count to disagree with yet.
    expect(renderGrid({ enabled: true, minCardWidth: 280 })).toContain(
      "repeat(auto-fill, minmax(280px, 1fr))"
    );
    expect(renderGrid({ enabled: true, columns: 3 })).toContain(
      "repeat(3, minmax(0, 1fr))"
    );
  });

  it("declares the tracks from the same count that slices the rows", async () => {
    // jsdom never lays out, so stand in for a measured 900px grid.
    const clientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 900,
    });
    const root = createSmokeRoot();
    const rows: Row[] = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: `Row ${id}`,
      sources: "1/1",
    }));

    try {
      await root.render(
        React.createElement(SettingsTableCardGrid<Row>, {
          cardView: {
            enabled: true,
            titleColumnKey: "model",
            minCardWidth: 280,
          },
          columns: COLUMNS,
          rows,
          getRowKey: (row: Row) => row.id,
          expandLabels: EXPAND_LABELS,
          expandable: {
            rowExpandable: () => true,
            expandedRowRender: (row: Row) =>
              React.createElement("div", null, `detail-${row.id}`),
            expandedRowKeys: ["a"],
            onExpandedRowsChange: vi.fn(),
          },
        })
      );

      const grid = root.container.querySelector<HTMLElement>(".grid");
      // 900px at a 280px minimum and an 8px gap is three tracks — declared
      // explicitly, so CSS cannot pack a different number than the count that
      // decides where the detail panel goes.
      expect(grid?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      // The measured element carries no padding of its own, so its clientWidth
      // is the width CSS lays tracks in.
      expect(grid?.className).not.toContain("p-4");
      expect(grid?.parentElement?.className).toContain("p-4");

      // The first row's expanded detail lands after that row's LAST card, so
      // the two cards beside it keep their places instead of being pushed to
      // the next line.
      const children = Array.from(grid?.children ?? []);
      const detailIndex = children.findIndex((child) =>
        child.classList.contains("settings-table-card-detail")
      );
      expect(detailIndex).toBe(3);
      expect(children[0].textContent).toContain("Row a");
      expect(children[1].textContent).toContain("Row b");
      expect(children[2].textContent).toContain("Row c");
      expect(children[detailIndex].textContent).toContain("detail-a");
    } finally {
      await root.unmount();
      if (clientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          clientWidth
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
      }
    }
  });

  it("derives the grid's column count the way auto-fill does", () => {
    // repeat(auto-fill, minmax(280px, 1fr)) with an 8px gap, measured on the
    // grid's content width.
    expect(resolveCardColumnCount(0, 280)).toBe(1);
    expect(resolveCardColumnCount(560, 280)).toBe(1);
    expect(resolveCardColumnCount(568, 280)).toBe(2);
    expect(resolveCardColumnCount(900, 280)).toBe(3);
    // A fixed column count wins over the measured width.
    expect(resolveCardColumnCount(900, 280, 2)).toBe(2);
  });

  it("replaces the derived layout with renderCard", () => {
    const markup = renderGrid({
      enabled: true,
      renderCard: (row) => React.createElement("p", null, `custom-${row.id}`),
    });

    expect(markup).toContain("custom-gpt");
    expect(markup).toContain("custom-glm");
    expect(markup).not.toContain("Enabled Sources");
  });

  it("paginates rows client-side when a page size is given", () => {
    const markup = renderGrid(
      { enabled: true, titleColumnKey: "model" },
      {
        pageSize: 1,
        renderPagination: (ctx) =>
          React.createElement(
            "span",
            null,
            `page ${ctx.pageIndex + 1}/${ctx.pageCount}`
          ),
      }
    );

    expect(markup).toContain("GPT 6 Astra");
    expect(markup).not.toContain("GLM 5.2");
    expect(markup).toContain("page 1/2");
  });

  it("renders the detail panel below the card's row, not inside the card", async () => {
    const root = createSmokeRoot();
    const onExpandedRowsChange = vi.fn();

    const element = (expandedRowKeys: string[]) =>
      React.createElement(SettingsTableCardGrid<Row>, {
        cardView: { enabled: true, titleColumnKey: "model" },
        columns: COLUMNS,
        rows: ROWS,
        getRowKey: (row: Row) => row.id,
        expandLabels: EXPAND_LABELS,
        expandable: {
          rowExpandable: () => true,
          expandedRowRender: (row: Row) =>
            React.createElement("div", null, `detail-${row.id}`),
          expandedRowKeys,
          onExpandedRowsChange,
        },
      });

    await root.render(element([]));

    const card = root.container.querySelector<HTMLElement>(
      ".settings-table-card"
    );
    expect(card).not.toBeNull();
    expect(root.container.textContent).not.toContain("detail-gpt");

    card?.click();
    expect(onExpandedRowsChange).toHaveBeenCalledWith(["gpt"]);

    await root.render(element(["gpt"]));

    const expandedCard = root.container.querySelector<HTMLElement>(
      ".settings-table-card"
    );
    const detail = root.container.querySelector<HTMLElement>(
      ".settings-table-card-detail"
    );

    expect(root.container.textContent).toContain("detail-gpt");
    // The detail lives outside the card, spans the whole grid row, and sits
    // after every card of that row.
    expect(expandedCard?.contains(detail ?? null)).toBe(false);
    expect(detail?.style.gridColumn).toBe("1 / -1");

    // jsdom reports a 0px container, so the grid is one column wide: the
    // detail belongs directly after its own card and before the next one.
    const children = Array.from(detail?.parentElement?.children ?? []);
    expect(children.indexOf(detail as Element)).toBe(
      children.indexOf(expandedCard as Element) + 1
    );
    expect(children).toHaveLength(ROWS.length + 1);
    // The open card wears the focused-Input treatment: primary border plus the
    // same 2px 15% halo.
    expect(expandedCard?.className).toContain("border-primary-6");
    expect(expandedCard?.className).toContain(
      "shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent)]"
    );
    // The slot draws no chrome of its own — expanded content already carries a
    // surface, and a border here would double up on it.
    expect(detail?.className).not.toMatch(/\bborder\b|\brounded|\bbg-/);

    await root.unmount();
  });

  it("ignores clicks that land on a control inside the card", async () => {
    const root = createSmokeRoot();
    const onRowClick = vi.fn();

    await root.render(
      React.createElement(SettingsTableCardGrid<Row>, {
        cardView: {
          enabled: true,
          titleColumnKey: "model",
          actionColumnKeys: ["status"],
        },
        columns: COLUMNS,
        rows: ROWS,
        getRowKey: (row: Row) => row.id,
        expandLabels: EXPAND_LABELS,
        onRowClick,
      })
    );

    const toggle = Array.from(root.container.querySelectorAll("button")).find(
      (button) => button.textContent === "toggle-gpt"
    );
    expect(toggle).toBeDefined();

    toggle?.click();
    expect(onRowClick).not.toHaveBeenCalled();

    root.container.querySelector<HTMLElement>(".settings-table-card")?.click();
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);

    await root.unmount();
  });
});
