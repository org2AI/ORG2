// @vitest-environment jsdom
import { type ReactNode, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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

import { testTranslate, useTestTranslation } from "@src/test/i18nTestTranslate";

import { ExternalBrowserButton } from "./ExternalBrowserButton";

const { openInSystemBrowser } = vi.hoisted(() => ({
  openInSystemBrowser: vi.fn(),
}));

vi.mock("@src/util/ui/openLink", () => ({
  openInSystemBrowser,
}));

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

vi.mock("@src/components/KeyboardShortcut/ToolbarTooltip", () => ({
  ToolbarTooltip: ({
    label,
    children,
  }: {
    label: string;
    children: ReactNode;
  }) =>
    createElement("span", { "data-shortcut-tooltip-label": label }, children),
}));

describe("ExternalBrowserButton", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    openInSystemBrowser.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("renders a Chrome button with standard hover and pressed feedback", () => {
    const markup = renderToStaticMarkup(
      createElement(ExternalBrowserButton, {
        href: "https://github.com/openai/example/pull/42",
      })
    );

    expect(markup).toContain(
      `data-shortcut-tooltip-label="${testTranslate(
        "common:previews.openInExternalBrowser"
      )}"`
    );
    expect(markup).toMatch(/<button\b[^>]*type="button"/);
    expect(markup).toContain(
      `aria-label="${testTranslate("common:previews.openInExternalBrowser")}"`
    );
    expect(markup).toContain('data-icon="chrome"');
    expect(markup).toContain("btn-hover:bg-surface-hover");
    expect(markup).toContain("btn-active:bg-surface-selected");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain(
      `title="${testTranslate("common:previews.openInExternalBrowser")}"`
    );
  });

  it("opens the supplied URL through the external-browser API", async () => {
    const onClick = vi.fn();
    act(() => {
      root.render(
        createElement(ExternalBrowserButton, {
          href: "https://github.com/openai/example/issues/42",
          onClick,
        })
      );
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(openInSystemBrowser).toHaveBeenCalledWith(
      "https://github.com/openai/example/issues/42"
    );
  });
});
