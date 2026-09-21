// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { SpotlightItem } from "../types";
import {
  type ListPinScope,
  usePinnedSpotlightItems,
} from "./usePinnedSpotlightItems";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it("persists directory pins through remounts with a fresh store and isolates main command pins", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const input: SpotlightItem[] = [
    { id: "repo-1", label: "Repo", type: "repo" },
  ];
  let output: SpotlightItem[] = [];
  function Harness({
    scope,
    enabled = true,
  }: {
    scope: ListPinScope;
    enabled?: boolean;
  }) {
    const items = usePinnedSpotlightItems(input, scope, enabled);
    useEffect(() => {
      output = items;
    }, [items]);
    return null;
  }
  function mount(scope: ListPinScope, enabled = true) {
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(
          Provider,
          { store: createStore() },
          createElement(Harness, { scope, enabled })
        )
      )
    );
    return root;
  }
  let root = mount("directories");
  act(() => output[0].data?.pinState?.onToggle());
  expect(output[0].data?.isHeader).toBe(true);
  expect(
    JSON.parse(localStorage.getItem("orgii-spotlight-directory-pins")!)
  ).toEqual(["repo-1"]);
  act(() => root.unmount());
  root = mount("directories");
  expect(output[1].data?.pinState?.pinned).toBe(true);
  act(() => root.unmount());
  root = mount("commands");
  expect(output).toHaveLength(1);
  expect(output[0].data?.pinState).toBeUndefined();
  act(() => root.unmount());
  root = mount("directories", false);
  expect(output).toBe(input);
  act(() => root.unmount());
});

it("pins an agent once even when it is listed under Recent and its group", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const header = (id: string): SpotlightItem => ({
    id,
    label: id,
    type: "option",
    data: { isHeader: true },
  });
  const agent = (group: string): SpotlightItem => ({
    id: `${group}:cli:codex`,
    label: "Codex",
    type: "action",
    data: { pinId: "cli:codex" },
  });
  const input: SpotlightItem[] = [
    header("__header_recent__"),
    agent("__header_recent__"),
    header("__header_cli__"),
    agent("__header_cli__"),
    {
      id: "__header_cli__:cli:claude",
      label: "Claude",
      type: "action",
      data: { pinId: "cli:claude" },
    },
  ];
  let output: SpotlightItem[] = [];
  function Harness() {
    const items = usePinnedSpotlightItems(input, "agents");
    useEffect(() => {
      output = items;
    }, [items]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      createElement(Provider, { store: createStore() }, createElement(Harness))
    )
  );
  act(() => output[1].data?.pinState?.onToggle());
  expect(output.map((item) => item.id)).toEqual([
    "section-user-pinned",
    "__header_recent__:cli:codex",
    "__header_cli__",
    "__header_cli__:cli:claude",
  ]);
  expect(
    JSON.parse(localStorage.getItem("orgii-spotlight-agent-pins")!)
  ).toEqual(["cli:codex"]);
  act(() => root.unmount());
});
