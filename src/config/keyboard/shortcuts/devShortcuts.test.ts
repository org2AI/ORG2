import { afterEach, describe, expect, it, vi } from "vitest";

import { DEV_SHORTCUTS } from "./devShortcuts";

/**
 * `ALL_SHORTCUTS` folds the dev entries in at module-eval time, so each case
 * re-imports the catalog under the NODE_ENV it wants.
 */
async function loadCatalogUnder(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const { ALL_SHORTCUTS } = await import("./allShortcuts");
  return ALL_SHORTCUTS;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadBindingsUnder(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("../shortcutBindings");
}

function chordEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "d",
    code: "KeyD",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    getModifierState: () => false,
    ...init,
  } as KeyboardEvent;
}

describe("dev-only shortcuts", () => {
  it("reaches the catalog in a development build", async () => {
    const catalog = await loadCatalogUnder("development");
    const ids = catalog.map((entry) => entry.id);

    for (const entry of DEV_SHORTCUTS) expect(ids).toContain(entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is absent from a production catalog, so its chords stay free", async () => {
    const catalog = await loadCatalogUnder("production");
    const ids = catalog.map((entry) => entry.id);

    for (const entry of DEV_SHORTCUTS) expect(ids).not.toContain(entry.id);
  });

  it("does not collide with a global chord that already exists", async () => {
    const catalog = await loadCatalogUnder("development");
    const devIds = new Set(DEV_SHORTCUTS.map((entry) => entry.id));
    const globalChords = catalog
      .filter((entry) => entry.scope === "global" && !devIds.has(entry.id))
      .map((entry) => entry.macKeys);

    for (const entry of DEV_SHORTCUTS) {
      expect(globalChords).not.toContain(entry.macKeys);
    }
  });

  it("resolves ⇧⌘D to the dev mock panel in a development build", async () => {
    const { matchesShortcut } = await loadBindingsUnder("development");

    expect(
      matchesShortcut(
        chordEvent({ metaKey: true, shiftKey: true }),
        "open_dev_mock_scenarios",
        "mac"
      )
    ).toBe(true);
    // The same key without Shift is the editor's ⌘D, not this panel.
    expect(
      matchesShortcut(
        chordEvent({ metaKey: true }),
        "open_dev_mock_scenarios",
        "mac"
      )
    ).toBe(false);
  });

  it("never resolves the chord in a production build", async () => {
    const { matchesShortcut } = await loadBindingsUnder("production");

    expect(
      matchesShortcut(
        chordEvent({ metaKey: true, shiftKey: true }),
        "open_dev_mock_scenarios",
        "mac"
      )
    ).toBe(false);
  });
});
