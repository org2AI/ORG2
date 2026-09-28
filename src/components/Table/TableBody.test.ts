// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import Checkbox from "@src/components/Checkbox";

import Table from ".";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("Table row interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps headers visible and confines loading to the body across transitions", () => {
    const render = (loading: boolean, data: { id: string }[]) => {
      act(() =>
        root.render(
          createElement(Table<{ id: string }>, {
            columns: [{ key: "id", title: "Name", dataIndex: "id" }],
            data,
            loading,
            pagination: false,
            noDataElement: createElement("span", null, "Empty records"),
          })
        )
      );
    };
    render(true, []);
    expect(container.querySelector("thead")?.textContent).toContain("Name");
    expect(
      container.querySelector("tbody[aria-busy='true'] [role='status']")
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Empty records");
    render(false, [{ id: "Loaded record" }]);
    expect(container.querySelector("tbody")?.textContent).toContain(
      "Loaded record"
    );
    expect(container.querySelector("tbody[aria-busy='true']")).toBeNull();
    render(true, [{ id: "Loaded record" }]);
    expect(container.querySelector("thead")?.textContent).toContain("Name");
    expect(container.querySelector("tbody")?.textContent).not.toContain(
      "Loaded record"
    );
    render(false, []);
    expect(container.querySelector("tbody")?.textContent).toContain(
      "Empty records"
    );
  });

  it("lets checkbox chrome toggle without invoking the row action", () => {
    const onCheckboxChange = vi.fn();
    const onRowClick = vi.fn();

    act(() => {
      root.render(
        createElement(Table<{ id: string }>, {
          columns: [
            {
              key: "selection",
              render: () =>
                createElement(Checkbox, {
                  ariaLabel: "Select row 1",
                  onCheckedChange: onCheckboxChange,
                }),
            },
          ],
          data: [{ id: "row-1" }],
          pagination: false,
          showHeader: false,
          onRowClick,
        })
      );
    });

    const checkboxIcon = container.querySelector<HTMLElement>(
      "[data-checkbox-icon]"
    );
    expect(checkboxIcon).not.toBeNull();

    act(() => checkboxIcon?.click());

    expect(onCheckboxChange).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>("[data-checkbox-input]")
        ?.checked
    ).toBe(true);

    const checkedIcon = container.querySelector("[data-checkbox-icon] svg");
    expect(checkedIcon).not.toBeNull();

    act(() => {
      checkedIcon?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(onCheckboxChange).toHaveBeenCalledTimes(2);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>("[data-checkbox-input]")
        ?.checked
    ).toBe(false);
  });

  it("expands settings rows without a chevron or expand column", () => {
    act(() => {
      root.render(
        createElement(Table<{ id: string }>, {
          columns: [{ key: "id", dataIndex: "id" }],
          data: [{ id: "row-1" }],
          rowKey: "id",
          pagination: false,
          showHeader: false,
          settings: true,
          expandable: {
            expandedRowRender: () => createElement("div", null, "Details"),
          },
        })
      );
    });

    const row = container.querySelector<HTMLTableRowElement>(".table-row");
    expect(row?.tabIndex).toBe(0);
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".table-expand-cell")).toBeNull();
    expect(container.querySelectorAll("colgroup col")).toHaveLength(1);

    act(() => row?.click());
    expect(row?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Details");

    act(() =>
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Details");

    act(() =>
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(row?.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles a settings row from non-interactive content when a row callback is present", () => {
    const onRowClick = vi.fn();
    const onActionClick = vi.fn();

    act(() => {
      root.render(
        createElement(Table<{ id: string }>, {
          columns: [
            {
              key: "name",
              render: () => createElement("span", null, "Row 1"),
            },
            {
              key: "action",
              render: () =>
                createElement(
                  "button",
                  { type: "button", onClick: onActionClick },
                  "Action"
                ),
            },
          ],
          data: [{ id: "row-1" }],
          rowKey: "id",
          pagination: false,
          showHeader: false,
          settings: true,
          onRowClick,
          expandable: {
            expandedRowRender: () => createElement("div", null, "Details"),
          },
        })
      );
    });

    const rowLabel = Array.from(container.querySelectorAll("span")).find(
      (element) => element.textContent === "Row 1"
    );
    const actionButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "Action"
    );

    act(() => rowLabel?.click());

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".table-row")?.getAttribute("aria-expanded")
    ).toBe("true");

    act(() => actionButton?.click());

    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".table-row")?.getAttribute("aria-expanded")
    ).toBe("true");

    act(() => rowLabel?.click());

    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector(".table-row")?.getAttribute("aria-expanded")
    ).toBe("false");
  });
});
