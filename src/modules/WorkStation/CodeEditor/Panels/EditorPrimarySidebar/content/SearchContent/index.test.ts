// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import navigation from "@src/i18n/locales/en/navigation.json";

import { SearchContent } from "./index";

const mocks = vi.hoisted(() => ({ search: vi.fn(), replace: vi.fn() }));
vi.mock("./useSearchContent", () => ({ useSearchContent: mocks.search }));
vi.mock("./replaceSearchFile", () => ({ replaceSearchResults: mocks.replace }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.startsWith("fileSearch.")
        ? navigation.fileSearch[
            key.slice(
              "fileSearch.".length
            ) as keyof typeof navigation.fileSearch
          ]
        : key,
  }),
}));
vi.mock("@src/icons", () => ({
  HugeiconsIcon: () => null,
  ArrowDown01Icon: {},
  ArrowRight01Icon: {},
  LinkSquare02Icon: {},
  ReplaceAllIcon: {},
  ReplaceIcon: {},
}));
vi.mock("@src/components/Placeholder", async () => {
  const { createElement } = await import("react");
  return {
    Placeholder: ({ title }: { title: string }) =>
      createElement("p", null, title),
  };
});
vi.mock("@src/modules/WorkStation/shared", () => ({
  HUMANTOOLS_TEXT_KEYS: {
    search: {
      expandReplace: "expandReplace",
      collapseReplace: "collapseReplace",
    },
  },
}));
vi.mock("@src/store/ui/workStationLayout/primarySidebarAtoms", async () => {
  const { atom } = await import("jotai");
  return { workStationSearchFocusSignalAtom: atom(0) };
});
vi.mock("@src/store/workstation/codeEditor/search", async () => {
  const { atom } = await import("jotai");
  return { searchQueryAtom: atom("needle"), searchOptionsAtom: atom({}) };
});
vi.mock("@src/store/workstation/tabs", async () => {
  const { atom } = await import("jotai");
  return {
    workstationLayoutAtom: atom({}),
    createSearchTab: vi.fn(),
    openTab: vi.fn(),
  };
});
vi.mock("../../../shared", async () => {
  // Keep the real ReplaceInput so its actual shared disabled button is tested.
  const { ReplaceInput } =
    await import("@src/modules/WorkStation/CodeEditor/Panels/shared/ReplaceInput");
  return {
    ReplaceInput,
    SearchFilters: () => null,
    SearchInput: () => null,
    SearchModeSelect: () => null,
  };
});
vi.mock("./components", () => ({ SearchResults: () => null }));

const options = {
  caseSensitive: false,
  wholeWord: true,
  useRegex: false,
  fileExtensions: [],
  excludeDirs: [],
  maxResults: 20_000,
};
const results = [
  {
    file_path: "/fixture/a.txt",
    matches: [
      {
        line: 1,
        end_line: 1,
        column: 1,
        end_column: 7,
        text: "needle",
        context_before: "",
        context_after: "",
      },
    ],
  },
];
function resultState() {
  return {
    query: "needle",
    setQuery: vi.fn(),
    options,
    setOptions: vi.fn(),
    results,
    loading: false,
    loadingMore: false,
    error: null as string | null,
    totalMatches: 1,
    totalFiles: 1,
    actualTotalMatches: 1,
    actualTotalFiles: 1,
    hasMore: false,
    isTruncated: false,
    loadMore: vi.fn(),
  };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  mocks.search.mockReturnValue(resultState());
  mocks.replace.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
async function render() {
  await act(async () =>
    root.render(
      React.createElement(
        Provider,
        { store: createStore() },
        React.createElement(SearchContent, {
          repoPath: "/fixture",
          onResultClick: vi.fn(),
        })
      )
    )
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[title="expandReplace"]')!
      .click()
  );
  const input = container.querySelector("textarea")!;
  act(() => {
    // Bypass React's value tracker as an actual browser input event does.
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!.call(input, "replacement");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function replaceButton() {
  return container.querySelector<HTMLButtonElement>(
    'button[title="tooltips.replaceAll"]'
  )!;
}

it.each([
  { hasMore: true },
  { isTruncated: true },
  { error: "partial search" },
])(
  "disables replace-all and explains incomplete results: %j",
  async (partial) => {
    mocks.search.mockReturnValue({ ...resultState(), ...partial });
    await render();
    expect(replaceButton().disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      navigation.fileSearch.budgetExceeded
    );
    act(() => replaceButton().click());
    expect(mocks.replace).not.toHaveBeenCalled();
  }
);

it("replaces a complete snapshot and renders a readable failure alert after rejection", async () => {
  let reject!: (error: Error) => void;
  mocks.replace.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
  );
  await render();
  expect(replaceButton().disabled).toBe(false);
  await act(async () => replaceButton().click());
  expect(mocks.replace).toHaveBeenCalledWith(
    results,
    "needle",
    "replacement",
    options,
    { loading: false, hasMore: false, isTruncated: false, error: null }
  );
  expect(replaceButton().disabled).toBe(true);
  await act(async () => reject(new Error("fixture write failure")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    navigation.fileSearch.replaceFailed
  );
  expect(replaceButton().disabled).toBe(false);
  expect(container.querySelector("textarea")?.value).toBe("replacement");
  expect(mocks.replace).toHaveBeenCalledTimes(1);
});
