// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PublishedHeaderSlotsView } from "@src/components/WindowChrome";
import { workstationTabHeaderAtomByHost } from "@src/store/workstation";
import { clearTabViewStates } from "@src/store/workstation/tabs/tabViewState";

import SearchEditorContent from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const submit = vi.hoisted(() => vi.fn());

vi.mock("./SearchEditorDocument", () => ({ default: () => null }));
vi.mock("./useSearchTabContent", () => ({
  useSearchTabContent: () => ({
    query: "input",
    submittedSearch: null,
    awaitingSubmission: true,
    refresh: submit,
    setQuery: vi.fn(),
    options: { caseSensitive: false, wholeWord: false, useRegex: false },
    setOptions: vi.fn(),
    results: [],
    loading: false,
    error: null,
  }),
}));

function Header() {
  const slots = useAtomValue(workstationTabHeaderAtomByHost.code);
  return React.createElement(
    "header",
    null,
    React.createElement(PublishedHeaderSlotsView, { slots })
  );
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SearchEditorContent header", () => {
  it("publishes controls, keeps extra filters in the body, and clears chrome on unmount", () => {
    const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    clearTabViewStates();
    const store = createStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(Header),
            React.createElement(
              "main",
              null,
              React.createElement(SearchEditorContent, {
                sessionScopeId: "search:header-test",
                repoPath: "/repo",
                onResultClick: vi.fn(),
              })
            )
          )
        )
      );
      const header = container.querySelector("header")!;
      const body = container.querySelector("main")!;
      expect(header.querySelector("input")?.value).toBe("input");
      expect(body.querySelector("input")).toBeNull();
      expect(body.textContent).toContain("placeholders.pressEnterToSearch");
      const input = header.querySelector("input")!;
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      });
      expect(submit).toHaveBeenCalledOnce();
      expect(
        store.get(workstationTabHeaderAtomByHost.code)?.sidebarToggleDisabled
      ).toBe(true);
      const filter = header.querySelector<HTMLButtonElement>(
        "button[aria-expanded]"
      )!;
      expect(filter).not.toBeNull();
      act(() => filter.click());
      expect(filter.getAttribute("aria-expanded")).toBe("true");
      expect(body.querySelectorAll("input")).toHaveLength(2);
      expect(header.querySelectorAll("input")).toHaveLength(1);
      act(() => filter.click());
      expect(body.querySelector("input")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      clearTabViewStates();
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
    expect(store.get(workstationTabHeaderAtomByHost.code)).toBeNull();
  });
});
