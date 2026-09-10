import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type PinnedAction,
  getPinnedActionKey,
  pinnedActionsAtom,
  slashItemToPinnedAction,
} from "../pinnedActionsAtom";

const STORAGE_KEY = "orgii:pinnedActions";

function hydratedStore() {
  const store = createStore();
  store.sub(pinnedActionsAtom, () => undefined);
  return store;
}

describe("pinned action identity", () => {
  it("matches a persisted skill after its display source and name change", () => {
    const persisted = {
      name: "Old label",
      skillName: "review-code",
      category: "skill" as const,
      source: "Old group",
    };
    const discovered = {
      name: "Review code",
      skillName: "review-code",
      category: "skill" as const,
      source: "Workspace Skills",
      description: "Review a change",
      acceptsArgs: false,
    };

    expect(getPinnedActionKey(persisted)).toBe(getPinnedActionKey(discovered));
  });

  it("keeps same-named tools from different MCP servers distinct", () => {
    expect(
      getPinnedActionKey({
        name: "search",
        category: "tool",
        source: "server-a",
        serverName: "server-a",
      })
    ).not.toBe(
      getPinnedActionKey({
        name: "search",
        category: "tool",
        source: "server-b",
        serverName: "server-b",
      })
    );
  });

  it("snapshots the fields needed to restore an available skill pin", () => {
    expect(
      slashItemToPinnedAction({
        name: "Review code",
        skillName: "review-code",
        skillPath: "/repo/.codex/skills/review-code",
        category: "skill",
        source: "Workspace Skills",
        description: "Review a change",
        acceptsArgs: false,
      })
    ).toEqual({
      name: "Review code",
      skillName: "review-code",
      skillPath: "/repo/.codex/skills/review-code",
      category: "skill",
      source: "Workspace Skills",
      serverName: undefined,
    });
  });
});

describe("pinnedActionsAtom persistence", () => {
  const reviewPin: PinnedAction = {
    name: "Review code",
    skillName: "review-code",
    category: "skill",
    source: "Workspace Skills",
  };

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("persists under the existing storage key", () => {
    const store = hydratedStore();
    store.set(pinnedActionsAtom, [reviewPin]);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([reviewPin]);
  });

  it("reads back stored pins and drops the legacy setup-repo pin", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { name: "setup-repo", category: "skill", source: "builtin" },
        reviewPin,
      ])
    );

    expect(hydratedStore().get(pinnedActionsAtom)).toEqual([reviewPin]);
  });

  it("falls back to no pins for corrupt JSON or a non-array payload", () => {
    localStorage.setItem(STORAGE_KEY, "[not json");
    expect(hydratedStore().get(pinnedActionsAtom)).toEqual([]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: "x" }));
    expect(hydratedStore().get(pinnedActionsAtom)).toEqual([]);
  });
});
