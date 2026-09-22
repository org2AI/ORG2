// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { copyText } from "@src/util/data/clipboard";

import DiffFileSection from ".";

vi.mock("@src/util/data/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@src/components/Message", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@src/components/FileTypeIcon", () => ({
  default: () => React.createElement("span", { "data-file-icon": true }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../SelectedTextAddToChat", () => ({
  SelectedTextAddToChat: ({
    children,
    displayName,
    filePath,
    enabled,
  }: {
    children?: React.ReactNode;
    displayName: string;
    filePath?: string;
    enabled?: boolean;
  }) =>
    React.createElement(
      "div",
      {
        "data-selected-text-owner": displayName,
        "data-selection-file-path": filePath,
        "data-selection-enabled": enabled,
      },
      children
    ),
}));

const FILE = {
  path: "src/index.tsx",
  status: "modified" as const,
  staged: false,
};
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

function renderSection(compactHeaderGutter = false) {
  return renderToStaticMarkup(
    React.createElement(
      Provider,
      null,
      React.createElement(DiffFileSection, {
        file: FILE,
        viewMode: "unified",
        defaultExpanded: false,
        compactHeaderGutter,
      })
    )
  );
}

describe("DiffFileSection header gutter", () => {
  it("keeps every collapsible file row at 36px", () => {
    const markup = renderSection();

    expect(markup).toContain("h-9 w-full");
    expect(markup).not.toContain("py-2");
  });

  it("keeps the shared gutter by default", () => {
    const markup = renderSection();

    expect(markup).toContain("px-3");
    expect(markup).not.toContain("px-2");
  });

  it("supports the compact Source Control gutter", () => {
    const markup = renderSection(true);

    expect(markup).toContain("px-2");
    expect(markup).not.toContain("px-3");
  });
});

describe("DiffFileSection selected-text ownership", () => {
  it("mounts the shared Add to Chat owner around expanded diff content", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        Provider,
        null,
        React.createElement(DiffFileSection, {
          file: {
            ...FILE,
            oldContent: "const before = 1;",
            newContent: "const after = 2;",
          },
          viewMode: "unified",
          defaultExpanded: true,
        })
      )
    );

    expect(markup).toContain('data-selected-text-owner="index.tsx"');
    expect(markup).toContain('data-selection-file-path="src/index.tsx"');
    expect(markup).toContain('data-selection-enabled="true"');
  });
});

describe("DiffFileSection open-file action", () => {
  it("renders a hover-revealed new-tab action before the counts and a plain filename", () => {
    const withoutAction = renderSection();
    const withAction = renderToStaticMarkup(
      React.createElement(
        Provider,
        null,
        React.createElement(DiffFileSection, {
          file: FILE,
          viewMode: "unified",
          defaultExpanded: false,
          onFileSelect: vi.fn(),
        })
      )
    );

    expect(withoutAction).not.toContain('data-icon="open-file-arrow"');
    expect(withAction).toContain('data-icon="open-file-arrow"');
    expect(withAction).not.toContain("hover:underline");
    expect(withAction).toContain("group-hover/diff-header:opacity-100");
    expect(withAction).toContain("group-focus-within/diff-header:opacity-100");
    const markupContainer = document.createElement("div");
    markupContainer.innerHTML = withAction;
    expect(markupContainer.querySelector("button button")).toBeNull();
    const title = Array.from(markupContainer.querySelectorAll("span")).find(
      (span) => span.textContent === "index.tsx"
    );
    expect(title?.closest("button")).toBeNull();
    const action = markupContainer
      .querySelector('[data-icon="open-file-arrow"]')
      ?.closest("button");
    expect(
      action?.parentElement?.nextElementSibling?.getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("copies and opens the absolute working-copy path without toggling the diff", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onFileSelect = vi.fn();

    act(() => {
      root.render(
        React.createElement(
          Provider,
          null,
          React.createElement(DiffFileSection, {
            file: FILE,
            viewMode: "unified",
            defaultExpanded: false,
            repoPath: "/workspace/project",
            onFileSelect,
          })
        )
      );
    });

    const openFileButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="common:actions.openInNewTab: src/index.tsx"]'
    );
    expect(openFileButton).not.toBeNull();
    expect(
      openFileButton?.querySelector('[data-icon="open-file-arrow"]')
    ).not.toBeNull();

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="actions.copyPath: src/index.tsx"]'
    );
    expect(copyButton?.parentElement).toBe(openFileButton?.parentElement);
    expect(copyButton?.parentElement?.classList.contains("gap-px")).toBe(true);
    await act(async () => copyButton?.click());
    expect(copyText).toHaveBeenCalledWith("/workspace/project/src/index.tsx");
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-icon="chevron-right"]')
    ).not.toBeNull();

    act(() => openFileButton?.click());

    expect(onFileSelect).toHaveBeenCalledOnce();
    expect(onFileSelect).toHaveBeenCalledWith(
      "/workspace/project/src/index.tsx"
    );
    expect(
      container.querySelector('[data-icon="chevron-right"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeNull();

    const disclosureButton = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]'
    );
    act(() => disclosureButton?.click());

    expect(onFileSelect).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-icon="chevron-down"]')
    ).not.toBeNull();

    act(() => root.unmount());
  });
});

describe("DiffFileSection badge hover hit target", () => {
  it.each(["modified", "deleted"] as const)(
    "shows only the %s status letter tooltip above the header overlay",
    (status) => {
      vi.useFakeTimers();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const onExpansionChange = vi.fn();
      try {
        act(() => {
          root.render(
            React.createElement(
              Provider,
              null,
              React.createElement(DiffFileSection, {
                file: { ...FILE, status, additions: 2, deletions: 1 },
                viewMode: "unified",
                defaultExpanded: false,
                onExpansionChange,
              })
            )
          );
        });
        const button = container.querySelector<HTMLButtonElement>(
          "button.pointer-events-auto[aria-expanded], button.pointer-events-auto[aria-disabled]"
        )!;
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(false);
        expect(button.closest(".pointer-events-none")).not.toBeNull();
        for (const [text, label] of [
          ["+2", null],
          ["-1", null],
          [
            status === "modified" ? "M" : "D",
            `common:gitLabels.${status === "modified" ? "M" : "D"}`,
          ],
        ]) {
          const target = Array.from(button.querySelectorAll("span")).find(
            (span) => span.textContent === text
          )!;
          expect(target).toBeDefined();
          act(() =>
            target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
          );
          act(() => vi.advanceTimersByTime(499));
          expect(document.querySelector(".native-tooltip")).toBeNull();
          act(() => vi.advanceTimersByTime(1));
          act(() => vi.advanceTimersByTime(32));
          const tooltip = document.querySelector(".native-tooltip-visible");
          if (label === null) {
            expect(tooltip).toBeNull();
          } else {
            expect(tooltip?.textContent).toBe(label);
          }
          act(() =>
            target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
          );
          act(() => vi.advanceTimersByTime(100));
        }
        act(() => button.click());
        if (status === "deleted") {
          expect(onExpansionChange).not.toHaveBeenCalled();
        } else {
          expect(onExpansionChange).toHaveBeenCalledWith(true);
        }
      } finally {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
      }
    }
  );
});
