// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserSession,
  BrowserState,
} from "@src/engines/BrowserCore/types";
import { focusBrowserUrlBar } from "@src/modules/WorkStation/Browser/shared/urlBarFocus";
import { requestNewBrowserSessionAtom } from "@src/store/workstation/workstationTabBarAtoms";

import { useNewBrowserSessionRequest } from "./useNewBrowserSessionRequest";

vi.mock("@src/modules/WorkStation/Browser/shared/urlBarFocus", () => ({
  focusBrowserUrlBar: vi.fn(),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function createSession(id: string, url = ""): BrowserSession {
  return {
    id,
    url,
    title: "New tab",
    history: [],
    historyIndex: -1,
    isLoading: false,
    error: null,
  };
}

interface HarnessProps {
  activeSessionId: string;
  addSession: BrowserState["addSession"];
  sessions: BrowserSession[];
}

function Harness({
  activeSessionId,
  addSession,
  sessions,
}: HarnessProps): null {
  useNewBrowserSessionRequest({
    activeSessionId,
    activeSession: sessions.find((session) => session.id === activeSessionId),
    addSession,
    sessions,
    closeSession: vi.fn(),
    setActiveSession: vi.fn(),
    updateSession: vi.fn(),
  });
  return null;
}

describe("useNewBrowserSessionRequest", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = createStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("focuses a blank tab only after its session becomes active", async () => {
    const addSession = vi.fn(() => "new-session");
    store.set(requestNewBrowserSessionAtom, {});

    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Harness, {
            activeSessionId: "",
            addSession,
            sessions: [],
          })
        )
      );
    });

    expect(addSession).toHaveBeenCalledWith(undefined, undefined);
    expect(focusBrowserUrlBar).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Harness, {
            activeSessionId: "new-session",
            addSession,
            sessions: [createSession("new-session")],
          })
        )
      );
    });

    expect(focusBrowserUrlBar).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus for a tab opened with a URL", async () => {
    const addSession = vi.fn(() => "linked-session");
    store.set(requestNewBrowserSessionAtom, { url: "https://example.com" });

    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(Harness, {
            activeSessionId: "linked-session",
            addSession,
            sessions: [createSession("linked-session", "https://example.com")],
          })
        )
      );
    });

    expect(addSession).toHaveBeenCalledWith("https://example.com", undefined);
    expect(focusBrowserUrlBar).not.toHaveBeenCalled();
  });
});
