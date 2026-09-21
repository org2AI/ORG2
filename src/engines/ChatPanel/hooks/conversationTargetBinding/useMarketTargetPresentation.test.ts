// @vitest-environment jsdom
import { Provider, atom, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import {
  type RecentModelEntry,
  recentModelEntriesAtom,
} from "@src/store/session/recentModelEntriesAtom";

import { useMarketTargetPresentation } from "./useMarketTargetPresentation";

vi.mock("@src/store/session/recentModelEntriesAtom", () => ({
  recentModelEntriesAtom: atom<RecentModelEntry[]>([]),
  findRecentByCredentialSource: (entries: RecentModelEntry[], source: string) =>
    entries.find((entry) => entry.credentialSource === source),
}));
const cleanups: Array<() => void> = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()));

function setup(selection: LastModelSelection | null) {
  const store = createStore();
  const root = createRoot(document.createElement("div"));
  let result: LastModelSelection | null = null;
  function Probe() {
    const current = useMarketTargetPresentation(selection);
    useEffect(() => {
      result = current;
    }, [current]);
    return null;
  }
  act(() =>
    root.render(
      React.createElement(Provider, { store }, React.createElement(Probe))
    )
  );
  cleanups.push(() => act(() => root.unmount()));
  return {
    read: () => result,
    update(entries: RecentModelEntry[]) {
      act(() => store.set(recentModelEntriesAtom, entries));
    },
  };
}
const selected: LastModelSelection = {
  keySource: "own_key",
  credentialSource: "market:selected-purchase",
  model: "gpt-model",
  provider: "openai_api",
  selectedSourceLabel: "ORG2 Market",
};
const recent = (source: string, label: string): RecentModelEntry => ({
  credentialSource: source,
  marketProfileId: `market:profile:${source}`,
  accountName: label,
  modelId: "different-model",
  modelType: "anthropic_api",
  sourceType: "own_key",
});

it("retains the safe fallback on a cold miss and never borrows another purchase's label", () => {
  const view = setup(selected);
  expect(view.read()).toBe(selected);
  view.update([recent("market:other-purchase", "Package · 1/2")]);
  expect(view.read()).toBe(selected);
});

it("reacts to the exact just-picked/restored source, preserving routing and selected model", () => {
  const view = setup(selected);
  const match = recent(selected.credentialSource!, "Package · 2/2");
  view.update([recent("market:other-purchase", "Package · 1/2"), match]);
  expect(view.read()).toEqual({
    ...selected,
    selectedSourceLabel: "Package · 2/2",
    marketProfileId: match.marketProfileId,
  });
  view.update([]);
  expect(view.read()).toBe(selected);
});

it("leaves Account Key and unresolved selections unchanged", () => {
  const ownKey: LastModelSelection = {
    keySource: "own_key",
    selectedAccountId: "account",
    model: "gpt-model",
    selectedSourceLabel: "My Account",
  };
  const account = setup(ownKey);
  account.update([recent("market:selected-purchase", "Package")]);
  expect(account.read()).toBe(ownKey);
  expect(setup(null).read()).toBeNull();
});
