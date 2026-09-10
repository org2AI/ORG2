import { createStore } from "jotai/vanilla";
import { beforeEach } from "vitest";

import {
  SESSION_BRANCH_TAGS_VISIBLE_STORAGE_KEY,
  clearSessionSidebarRevealAtom,
  requestSessionSidebarRevealAtom,
  sessionBranchTagsVisibleAtom,
  sessionSidebarRevealRequestAtom,
  sidebarCollapsedAtom,
  sidebarWidthAtom,
  updateSidebarViewportAtom,
} from "../sidebarAtom";

beforeEach(() => {
  localStorage.removeItem(SESSION_BRANCH_TAGS_VISIBLE_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(sessionBranchTagsVisibleAtom, () => undefined);
  return store;
}

describe("sessionBranchTagsVisibleAtom", () => {
  it("hides branch tags by default", () => {
    expect(hydratedStore().get(sessionBranchTagsVisibleAtom)).toBe(false);
  });

  it("persists an enabled choice for the future settings control", () => {
    const writer = hydratedStore();
    writer.set(sessionBranchTagsVisibleAtom, true);

    expect(
      JSON.parse(
        localStorage.getItem(SESSION_BRANCH_TAGS_VISIBLE_STORAGE_KEY) ?? "null"
      )
    ).toBe(true);
    expect(hydratedStore().get(sessionBranchTagsVisibleAtom)).toBe(true);
  });

  it("falls back to hidden for a malformed stored value", () => {
    localStorage.setItem(
      SESSION_BRANCH_TAGS_VISIBLE_STORAGE_KEY,
      JSON.stringify("visible")
    );

    expect(hydratedStore().get(sessionBranchTagsVisibleAtom)).toBe(false);
  });
});

describe("requestSessionSidebarRevealAtom", () => {
  it("normalizes identities and increments repeated reveal requests", () => {
    const store = createStore();

    store.set(requestSessionSidebarRevealAtom, {
      sessionId: " child-session ",
      parentSessionId: " root-session ",
    });
    expect(store.get(sessionSidebarRevealRequestAtom)).toEqual({
      sessionId: "child-session",
      parentSessionId: "root-session",
      requestId: 1,
      issuedAt: expect.any(Number),
    });

    store.set(requestSessionSidebarRevealAtom, {
      sessionId: "child-session",
      parentSessionId: "root-session",
    });
    expect(store.get(sessionSidebarRevealRequestAtom)?.requestId).toBe(2);
  });

  it("ignores an empty canonical session ID", () => {
    const store = createStore();

    store.set(requestSessionSidebarRevealAtom, { sessionId: "   " });

    expect(store.get(sessionSidebarRevealRequestAtom)).toBeNull();
  });

  it("preserves an exact Team Session reveal target", () => {
    const store = createStore();

    store.set(requestSessionSidebarRevealAtom, {
      sessionId: " imported-session-1 ",
      sidebarItemId: " cloudremote-org-1|org-1:user-1:source-1 ",
      cloudOrgId: " org-1 ",
    });

    expect(store.get(sessionSidebarRevealRequestAtom)).toEqual({
      sessionId: "imported-session-1",
      sidebarItemId: "cloudremote-org-1|org-1:user-1:source-1",
      cloudOrgId: "org-1",
      requestId: 1,
      issuedAt: expect.any(Number),
    });
  });

  it("clears only the reveal request that was actually completed", () => {
    const store = createStore();
    store.set(requestSessionSidebarRevealAtom, { sessionId: "session-a" });
    const firstRequestId = store.get(
      sessionSidebarRevealRequestAtom
    )!.requestId;
    store.set(requestSessionSidebarRevealAtom, { sessionId: "session-b" });

    store.set(clearSessionSidebarRevealAtom, firstRequestId);
    expect(store.get(sessionSidebarRevealRequestAtom)?.sessionId).toBe(
      "session-b"
    );

    store.set(
      clearSessionSidebarRevealAtom,
      store.get(sessionSidebarRevealRequestAtom)!.requestId
    );
    expect(store.get(sessionSidebarRevealRequestAtom)).toBeNull();

    store.set(requestSessionSidebarRevealAtom, { sessionId: "session-c" });
    expect(store.get(sessionSidebarRevealRequestAtom)?.requestId).toBe(3);
  });
});

describe("responsive sidebar", () => {
  function wideStore(collapsed = false) {
    const store = createStore();
    store.set(updateSidebarViewportAtom, 1200);
    store.set(sidebarCollapsedAtom, collapsed);
    return store;
  }

  it("collapses below 960 and restores at 960 without persisting automatic changes", () => {
    const store = wideStore();
    store.set(sidebarWidthAtom, 280);
    for (let cycle = 0; cycle < 3; cycle++) {
      store.set(updateSidebarViewportAtom, 959);
      expect(store.get(sidebarCollapsedAtom)).toBe(true);
      expect(localStorage.getItem("orgii_sidebar_collapsed")).toBe("false");
      store.set(updateSidebarViewportAtom, 960);
      expect(store.get(sidebarCollapsedAtom)).toBe(false);
      expect(store.get(sidebarWidthAtom)).toBe(280);
    }
  });

  it("preserves a manually collapsed wide-window preference", () => {
    const store = wideStore(true);
    store.set(updateSidebarViewportAtom, 700);
    store.set(sidebarCollapsedAtom, false);
    store.set(updateSidebarViewportAtom, 1200);
    expect(store.get(sidebarCollapsedAtom)).toBe(true);
    expect(localStorage.getItem("orgii_sidebar_collapsed")).toBe("true");
  });

  it("allows manual expansion while narrow until the next crossing", () => {
    const store = wideStore();
    store.set(updateSidebarViewportAtom, 700);
    store.set(sidebarCollapsedAtom, false);
    store.set(updateSidebarViewportAtom, 800);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
    store.set(updateSidebarViewportAtom, 1200);
    store.set(updateSidebarViewportAtom, 700);
    expect(store.get(sidebarCollapsedAtom)).toBe(true);
  });

  it("does not publish changes for same-side resizes or share responsive state across stores", () => {
    const first = wideStore();
    const second = wideStore();
    let changes = 0;
    const unsubscribe = first.sub(sidebarCollapsedAtom, () => changes++);
    first.set(updateSidebarViewportAtom, 1100);
    expect(changes).toBe(0);
    first.set(updateSidebarViewportAtom, 700);
    first.set(updateSidebarViewportAtom, 800);
    expect(changes).toBe(1);
    expect(second.get(sidebarCollapsedAtom)).toBe(false);
    unsubscribe();
  });
});
