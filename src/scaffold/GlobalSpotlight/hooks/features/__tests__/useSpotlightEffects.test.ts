// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { spotlightInitialQueryAtom } from "@src/store/ui/uiAtom";

import { createBranchSpotlightRequest } from "../../../openSpotlight";
import { useSpotlightEffects } from "../useSpotlightEffects";

it("consumes each repo-scoped branch request once and does not replay it on reopen", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createStore();
  const onOpenBranchLayer = vi.fn();
  const dispatch = vi.fn();
  const closeModal = vi.fn();
  function Harness({ isOpen }: { isOpen: boolean }) {
    useSpotlightEffects({ isOpen, dispatch, closeModal, onOpenBranchLayer });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (isOpen: boolean) =>
    act(() =>
      root.render(
        createElement(Provider, { store }, createElement(Harness, { isOpen }))
      )
    );
  try {
    store.set(
      spotlightInitialQueryAtom,
      createBranchSpotlightRequest("repo-b")
    );
    render(false);
    expect(onOpenBranchLayer).not.toHaveBeenCalled();
    render(true);
    expect(onOpenBranchLayer).toHaveBeenCalledTimes(1);
    expect(onOpenBranchLayer).toHaveBeenLastCalledWith("repo-b");
    expect(store.get(spotlightInitialQueryAtom)).toBeNull();
    render(false);
    render(true);
    expect(onOpenBranchLayer).toHaveBeenCalledTimes(1);
    act(() =>
      store.set(
        spotlightInitialQueryAtom,
        createBranchSpotlightRequest("repo-a")
      )
    );
    expect(onOpenBranchLayer).toHaveBeenLastCalledWith("repo-a");
    expect(onOpenBranchLayer).toHaveBeenCalledTimes(2);
    act(() =>
      store.set(spotlightInitialQueryAtom, createBranchSpotlightRequest())
    );
    expect(onOpenBranchLayer).toHaveBeenLastCalledWith(undefined);
    expect(store.get(spotlightInitialQueryAtom)).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
