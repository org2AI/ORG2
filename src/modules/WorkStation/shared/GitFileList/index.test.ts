// @vitest-environment jsdom
import React, { act } from "react";
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

import type { GitFile } from "@src/types/git/types";

import GitFileList from ".";

vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const { default: en } = await import("@src/i18n/locales/en/common.json");
  const instance = createInstance();
  await instance.init({ lng: "en", resources: { en: { translation: en } } });
  return { useTranslation: () => ({ t: instance.t.bind(instance) }) };
});

vi.mock("@src/components/FileTypeIcon", () => ({
  default: ({ fileName }: { fileName: string }) =>
    React.createElement("span", { "data-file-icon": fileName }),
}));

vi.mock("@src/components/VirtualizedStickyTree", () => ({
  CHEVRON_SIZE: 14,
  STICKY_ROW: {
    row: "sticky-row",
    chevronBox: "sticky-chevron-box",
    chevronIcon: "sticky-chevron-icon",
    nameBase: "sticky-name",
  },
  VirtualizedStickyTree: ({
    flattenedNodes,
    renderItem,
  }: {
    flattenedNodes: Array<{ node: { path: string }; depth: number }>;
    renderItem: (
      item: { node: { path: string }; depth: number },
      index: number
    ) => React.ReactNode;
  }) =>
    React.createElement(
      "div",
      { "data-virtualized-tree": true },
      ...flattenedNodes.map((item, index) =>
        React.createElement(
          React.Fragment,
          { key: item.node.path },
          renderItem(item, index)
        )
      )
    ),
  stickyRowPadding: () => ({}),
}));

const file: GitFile = {
  id: "src/components/Button.tsx",
  path: "src/components/Button.tsx",
  status: "modified",
  additions: 2,
  deletions: 1,
  staged: true,
};

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("GitFileList row styling", () => {
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
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each(["list", "list-tree"] as const)(
    "uses the shared Station row radius in %s mode",
    (defaultViewMode) => {
      act(() => {
        root.render(
          React.createElement(GitFileList, {
            files: [file],
            selectedFileId: file.id,
            onFileSelect: vi.fn(),
            defaultViewMode,
          })
        );
      });

      const rows = container.querySelectorAll(".tree-row-base");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.classList.contains("rounded-md")).toBe(true);
      }
    }
  );

  it("renders a capped unfiltered count label", () => {
    act(() => {
      root.render(
        React.createElement(GitFileList, {
          files: [file],
          unfilteredCountLabel: "3000+",
          selectedFileId: file.id,
          onFileSelect: vi.fn(),
        })
      );
    });

    expect(
      container.querySelector(".group\\/header button")?.textContent
    ).toContain("3000+ changed file");
    expect(container.querySelector(".group\\/header > div > span")).toBeNull();
  });
  it.each([0, 1, 2])(
    "puts %i changed files in the title without a badge",
    (count) => {
      act(() =>
        root.render(
          React.createElement(GitFileList, {
            files: Array.from({ length: count }, (_, i) => ({
              ...file,
              id: `file-${i}`,
              path: `file-${i}.ts`,
            })),
            selectedFileId: null,
            onFileSelect: vi.fn(),
          })
        )
      );
      expect(
        container.querySelector(".group\\/header button")?.textContent
      ).toBe(`${count} changed ${count === 1 ? "file" : "files"}`);
      expect(
        container.querySelector(".group\\/header > div > span")
      ).toBeNull();
    }
  );
});
