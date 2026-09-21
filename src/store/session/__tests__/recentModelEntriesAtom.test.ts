import { describe, expect, it } from "vitest";

import { KEY_SOURCE } from "@src/api/tauri/session";

import {
  type RecentModelEntry,
  recentEntriesEquivalent,
  recordRecentEntry,
} from "../recentModelEntriesAtom";

const entry = (
  modelId: string,
  accountId = "openai-key"
): RecentModelEntry => ({
  modelId,
  sourceType: KEY_SOURCE.OWN,
  accountId,
  accountName: "OpenAI",
  modelType: "codex",
});

describe("recentEntriesEquivalent", () => {
  it("treats variants of one model family on one key as the same selection", () => {
    expect(
      recentEntriesEquivalent(
        entry("gpt-6-astra-medium"),
        entry("gpt-6-astra-low")
      )
    ).toBe(true);
  });

  it("keeps different families and different keys apart", () => {
    expect(
      recentEntriesEquivalent(
        entry("gpt-6-astra-low"),
        entry("gpt-5.6-sol-low")
      )
    ).toBe(false);
    expect(
      recentEntriesEquivalent(
        entry("gpt-6-astra-low", "key-a"),
        entry("gpt-6-astra-low", "key-b")
      )
    ).toBe(false);
  });
});

describe("recordRecentEntry", () => {
  it("replaces an older variant of the same family instead of adding a row", () => {
    const stored = [entry("gpt-5.6-sol-xhigh"), entry("LongCat-2.0", "cat")];
    expect(recordRecentEntry(stored, entry("gpt-5.6-sol-high"))).toEqual([
      entry("gpt-5.6-sol-high"),
      entry("LongCat-2.0", "cat"),
    ]);
  });
});

const packageEntry = (
  sessionId: string,
  overrides: Partial<RecentModelEntry> = {}
): RecentModelEntry => ({
  modelId: "gpt-6-astra-low",
  sourceType: KEY_SOURCE.OWN,
  accountName: "Coding package",
  modelType: "codex",
  cliAgentType: "codex",
  marketProfileId: "market:00000000-0000-4000-8000-000000000001:pkg_one",
  credentialSource: `market:${btoa(JSON.stringify({ session_id: sessionId }))}`,
  ...overrides,
});

describe("Market recent identity", () => {
  it("replaces the prepared session at the Recent writer without duplicating the Package", () => {
    const old = packageEntry("session-a");
    const selected = packageEntry("session-b", {
      modelId: "gpt-6-astra-high",
      accountName: "Renamed package",
    });
    expect(recordRecentEntry([old], selected)).toEqual([selected]);
  });

  it.each([
    { marketProfileId: "market:00000000-0000-4000-8000-000000000001:pkg_two" },
    { marketProfileId: "market:00000000-0000-4000-8000-000000000002:pkg_one" },
    { modelType: "claude_code" as const, cliAgentType: "claude_code" as const },
    { modelType: "openai_api" as const, cliAgentType: undefined },
    { modelId: "gpt-5.6-luna" },
  ])(
    "keeps another Package, owner, engine or family separate: %o",
    (change) => {
      const old = packageEntry("session-a");
      const selected = packageEntry("session-b", change);
      expect(recordRecentEntry([old], selected)).toEqual([selected, old]);
    }
  );

  it.each([undefined, "not-market", `market:${"x".repeat(512)}`])(
    "preserves exact-source fallback when a stable id is unavailable (%s)",
    (marketProfileId) => {
      const old = packageEntry("session-a", { marketProfileId });
      expect(recentEntriesEquivalent(old, { ...old })).toBe(true);
      expect(recentEntriesEquivalent(old, packageEntry("session-b"))).toBe(
        false
      );
    }
  );
});
