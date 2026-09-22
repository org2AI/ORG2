// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
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

import { CHROME_INSET_TRANSITION_CLASSES } from "@src/components/layout/tokens/viewContainerTokens";
import { useShouldOffsetChatPanelHeader } from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

import {
  PANE_LAYOUT_INSET_TRANSITION_MS,
  usePaneLayoutInsetTransition,
} from "./usePaneLayoutInsetTransition";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

/** Stands in for the chat pane's header row: same inset, same transition. */
function HeaderProbe() {
  const offset = useShouldOffsetChatPanelHeader({
    position: "left",
    useExternalWidth: false,
  });
  const className = usePaneLayoutInsetTransition();
  return createElement("div", {
    "data-testid": "header-probe",
    "data-inset": offset ? "reserved" : "none",
    className,
  });
}

/** Stands in for a header row; `activeTabId` changes like a tab switch would. */
function InsetProbe({ activeTabId }: { activeTabId: string }) {
  const className = usePaneLayoutInsetTransition();
  return createElement("div", {
    "data-testid": "inset-probe",
    "data-active-tab": activeTabId,
    className,
  });
}

describe("usePaneLayoutInsetTransition", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // Pane layout is persisted; start every test with the station open, the
    // sidebar expanded and the chat pane showing.
    localStorage.clear();
    store = createStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  function render(activeTabId = "tab-a"): void {
    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(InsetProbe, { activeTabId })
        )
      );
    });
  }

  function probeClassName(): string | null {
    return container
      .querySelector('[data-testid="inset-probe"]')
      ?.getAttribute("class") as string | null;
  }

  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  /** Every pane toggle animates the inset for exactly one pane transition. */
  function expectTogglesInsetTransition(toggle: () => void): void {
    act(toggle);
    expect(probeClassName()).toBe(CHROME_INSET_TRANSITION_CLASSES);
    advance(PANE_LAYOUT_INSET_TRANSITION_MS);
    expect(probeClassName()).toBe("");
  }

  it("keeps insets still at rest and when tabs change inside the station", () => {
    render("tab-a");
    expect(probeClassName()).toBe("");

    render("tab-b");
    expect(probeClassName()).toBe("");
  });

  it("animates insets while the station closes and opens, then stops", () => {
    render();

    expectTogglesInsetTransition(() => store.set(chatPanelMaximizedAtom, true));
    expectTogglesInsetTransition(() =>
      store.set(chatPanelMaximizedAtom, false)
    );
  });

  it("animates insets while the sidebar collapses and expands", () => {
    render();

    expectTogglesInsetTransition(() => store.set(sidebarCollapsedAtom, true));
    expectTogglesInsetTransition(() => store.set(sidebarCollapsedAtom, false));
  });

  it("animates insets while the chat pane goes away and comes back", () => {
    render();

    expectTogglesInsetTransition(() => store.set(chatWidthAtom, 0));
    expectTogglesInsetTransition(() => store.set(chatWidthAtom, 520));
  });

  it("ignores a chat-pane resize that leaves the pane on screen", () => {
    render();

    act(() => store.set(chatWidthAtom, 360));
    expect(probeClassName()).toBe("");
  });

  it("does not let an earlier toggle cut a quick reopen short", () => {
    render();

    act(() => store.set(chatPanelMaximizedAtom, true));
    advance(PANE_LAYOUT_INSET_TRANSITION_MS - 100);
    act(() => store.set(chatPanelMaximizedAtom, false));

    // The first toggle's timer would have fired here.
    advance(100);
    expect(probeClassName()).toBe(CHROME_INSET_TRANSITION_CLASSES);

    advance(PANE_LAYOUT_INSET_TRANSITION_MS - 100);
    expect(probeClassName()).toBe("");
  });

  it("does not let one pane's toggle cut another pane's short", () => {
    render();

    act(() => store.set(sidebarCollapsedAtom, true));
    advance(PANE_LAYOUT_INSET_TRANSITION_MS - 100);
    act(() => store.set(chatPanelMaximizedAtom, true));

    advance(100);
    expect(probeClassName()).toBe(CHROME_INSET_TRANSITION_CLASSES);

    advance(PANE_LAYOUT_INSET_TRANSITION_MS - 100);
    expect(probeClassName()).toBe("");
  });

  it("turns the transition on in the render that flips a header's inset", () => {
    act(() => {
      root.render(
        createElement(Provider, { store }, createElement(HeaderProbe))
      );
    });
    const probe = () =>
      container.querySelector('[data-testid="header-probe"]') as HTMLDivElement;
    expect(probe().dataset.inset).toBe("none");
    expect(probe().className).toBe("");

    // A CSS transition takes its timing from the after-change style, so the
    // class has to be there the first time the reserved inset is.
    act(() => store.set(sidebarCollapsedAtom, true));
    expect(probe().dataset.inset).toBe("reserved");
    expect(probe().className).toBe(CHROME_INSET_TRANSITION_CLASSES);

    advance(PANE_LAYOUT_INSET_TRANSITION_MS);
    expect(probe().dataset.inset).toBe("reserved");
    expect(probe().className).toBe("");
  });

  it("stops animating once the station finishes toggling, even if tabs change meanwhile", () => {
    render("tab-a");

    act(() => store.set(chatPanelMaximizedAtom, true));
    render("tab-b");
    expect(probeClassName()).toBe(CHROME_INSET_TRANSITION_CLASSES);

    advance(PANE_LAYOUT_INSET_TRANSITION_MS);
    render("tab-c");
    expect(probeClassName()).toBe("");
  });
});
