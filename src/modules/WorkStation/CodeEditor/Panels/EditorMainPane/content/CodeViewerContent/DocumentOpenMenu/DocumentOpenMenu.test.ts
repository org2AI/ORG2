// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import DocumentOpenMenu from "./index";

const mocks = vi.hoisted(() => ({ load: vi.fn(), open: vi.fn(), mac: true }));
vi.mock("./documentApplications", () => ({
  loadDocumentApplications: mocks.load,
  openDocument: mocks.open,
}));
vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => mocks.mac,
  isTauriDesktop: () => true,
}));
vi.mock("react-i18next", () => {
  const t = (key: string, options?: { name?: string }) =>
    options?.name ? `${key}: ${options.name}` : key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("@src/components/Message", () => ({ default: { error: vi.fn() } }));
vi.mock("@src/components/Button", () => ({
  default: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props),
}));
vi.mock("@src/components/Dropdown", () => ({
  default: ({
    children,
    onVisibleChange,
    popupVisible,
    options,
    onSelect,
    disabled,
  }: {
    children: React.ReactElement;
    onVisibleChange: (v: boolean) => void;
    popupVisible: boolean;
    options: { value: string; label: string; disabled?: boolean }[];
    onSelect: (v: string) => void;
    disabled: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      React.cloneElement(
        children as React.ReactElement<Record<string, unknown>>,
        {
          "data-trigger": true,
          disabled,
          onClick: () => onVisibleChange(!popupVisible),
        }
      ),
      ...(popupVisible
        ? options.map((option) =>
            React.createElement(
              "button",
              {
                key: option.value,
                disabled: option.disabled,
                onClick: () => onSelect(option.value),
              },
              option.label
            )
          )
        : [])
    ),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.load.mockReset();
  mocks.load.mockResolvedValue([
    { path: "/Applications/Numbers.app", name: "Numbers", isDefault: true },
  ]);
  mocks.open.mockReset();
  mocks.mac = true;
  mocks.open.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(filePath = "/a.pdf", dirty = false) {
  await act(async () =>
    root.render(
      React.createElement(DocumentOpenMenu, {
        filePath,
        hasUnsavedChanges: dirty,
      })
    )
  );
}
async function toggle() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
      .click()
  );
}

it("loads on mount and discards a late result after file switch", async () => {
  let resolve!: (apps: unknown[]) => void;
  mocks.load.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  expect(mocks.load).toHaveBeenCalledWith("/a.pdf");
  expect(container.querySelector("img")).toBeNull();
  const resolveOld = resolve;
  await render("/b.pdf");
  await act(async () =>
    resolveOld([{ path: "/Old.app", name: "Old app", isDefault: false }])
  );
  expect(container.textContent).not.toContain("Old app");
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("does not detect applications on other platforms and opens the exact current file", async () => {
  mocks.mac = false;
  await render("/b.xlsx");
  await toggle();
  expect(mocks.load).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "documentOpen.defaultApp"
  )!;
  await act(async () => button.click());
  expect(mocks.open).toHaveBeenCalledWith("/b.xlsx", undefined);
});

it("prevents opening unsaved spreadsheet contents", async () => {
  await render("/b.xlsx", true);
  await toggle();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("shows the default app and icon before expansion and keeps them when toggled", async () => {
  await render("/a.numbers");
  const button = container.querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toContain("documentOpen.openInDefault: Numbers");
  const icon = button.querySelector("img")!;
  expect(icon.getAttribute("src")).toContain("numbers.svg");
  await toggle();
  expect(container.textContent).not.toContain("documentOpen.defaultApp");
  await toggle();
  expect(button.textContent).toContain("Numbers");
  expect(button.querySelector("img")!.getAttribute("src")).toBe(
    icon.getAttribute("src")
  );
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => button.click());
  expect(mocks.open).toHaveBeenCalledWith("/a.numbers");
});
