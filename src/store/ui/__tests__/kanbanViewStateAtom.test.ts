import { type Atom, createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  kanbanAgentTypeFilterAtom,
  kanbanAutoArchiveTtlAtom,
  kanbanManualArchivedSessionIdsAtom,
  kanbanSidebarFilterAtom,
  kanbanTimeFilterAtom,
} from "../kanbanViewStateAtom";

const KEYS = {
  agentType: "orgii:kanbanAgentTypeFilter",
  sidebar: "orgii:kanbanSidebarFilter",
  time: "orgii:kanbanTimeFilter",
  autoArchive: "orgii:kanbanAutoArchiveTtl",
  manualArchived: "orgii:kanbanManualArchivedSessions",
} as const;

function hydratedStore(atom: Atom<unknown>) {
  const store = createStore();
  store.sub(atom, () => undefined);
  return store;
}

function readStored<T>(key: string, atom: Atom<T>, raw: string): T {
  localStorage.setItem(key, raw);
  return hydratedStore(atom).get(atom);
}

beforeEach(() => {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
});

describe("kanban persisted preferences", () => {
  it("writes each preference under its existing storage key", () => {
    const store = createStore();
    store.set(kanbanAgentTypeFilterAtom, "claude_code");
    store.set(kanbanSidebarFilterAtom, "archived");
    store.set(kanbanTimeFilterAtom, "7d");
    store.set(kanbanAutoArchiveTtlAtom, "never");
    store.set(kanbanManualArchivedSessionIdsAtom, ["s1"]);

    expect(localStorage.getItem(KEYS.agentType)).toBe('"claude_code"');
    expect(localStorage.getItem(KEYS.sidebar)).toBe('"archived"');
    expect(localStorage.getItem(KEYS.time)).toBe('"7d"');
    expect(localStorage.getItem(KEYS.autoArchive)).toBe('"never"');
    expect(localStorage.getItem(KEYS.manualArchived)).toBe('["s1"]');
  });

  it("reads back valid stored values", () => {
    expect(
      readStored(KEYS.agentType, kanbanAgentTypeFilterAtom, '"custom:agent"')
    ).toBe("custom:agent");
    expect(
      readStored(KEYS.sidebar, kanbanSidebarFilterAtom, '"blocking"')
    ).toBe("blocking");
    expect(readStored(KEYS.time, kanbanTimeFilterAtom, '"12h"')).toBe("12h");
    expect(readStored(KEYS.autoArchive, kanbanAutoArchiveTtlAtom, '"3d"')).toBe(
      "3d"
    );
  });

  it("falls back to defaults for corrupt JSON", () => {
    expect(
      readStored(KEYS.agentType, kanbanAgentTypeFilterAtom, "{corrupt")
    ).toBe("all");
    expect(readStored(KEYS.sidebar, kanbanSidebarFilterAtom, "{corrupt")).toBe(
      "all"
    );
    expect(readStored(KEYS.time, kanbanTimeFilterAtom, "{corrupt")).toBe("3d");
    expect(
      readStored(KEYS.autoArchive, kanbanAutoArchiveTtlAtom, "{corrupt")
    ).toBe("24h");
    expect(
      readStored(
        KEYS.manualArchived,
        kanbanManualArchivedSessionIdsAtom,
        "{corrupt"
      )
    ).toEqual([]);
  });

  it("rejects values outside each accepted set", () => {
    expect(readStored(KEYS.agentType, kanbanAgentTypeFilterAtom, '""')).toBe(
      "all"
    );
    expect(readStored(KEYS.sidebar, kanbanSidebarFilterAtom, '"done"')).toBe(
      "all"
    );
    expect(readStored(KEYS.time, kanbanTimeFilterAtom, '"never"')).toBe("3d");
    expect(
      readStored(KEYS.autoArchive, kanbanAutoArchiveTtlAtom, '"99h"')
    ).toBe("24h");
  });

  it("keeps only string ids and bounds the manual-archive list on read and write", () => {
    expect(
      readStored(
        KEYS.manualArchived,
        kanbanManualArchivedSessionIdsAtom,
        JSON.stringify(["a", 1, null, "b"])
      )
    ).toEqual(["a", "b"]);

    const many = Array.from({ length: 1001 }, (_, i) => `s${i}`);
    expect(
      readStored(
        KEYS.manualArchived,
        kanbanManualArchivedSessionIdsAtom,
        JSON.stringify(many)
      )
    ).toHaveLength(1000);

    createStore().set(kanbanManualArchivedSessionIdsAtom, many);
    expect(JSON.parse(localStorage.getItem(KEYS.manualArchived)!)).toHaveLength(
      1000
    );
  });
});
