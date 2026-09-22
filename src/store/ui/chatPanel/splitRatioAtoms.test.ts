// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSettingsDefaults } from "@src/config/settingsSchema";
import { getChatWidthForRatio } from "@src/engines/ChatPanel/config";
import { settingsAtom } from "@src/store/settings";

import { chatSplitRatioAtom } from "./splitRatioAtoms";
import { chatWidthAtom } from "./widthAtoms";

const { rpcCallMock } = vi.hoisted(() => ({
  rpcCallMock: vi.fn(),
}));

vi.mock("@src/api/tauri/rpc/invoke", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@src/api/tauri/rpc/invoke")>();

  return {
    ...actual,
    rpcCall: rpcCallMock,
  };
});

describe("chatSplitRatioAtom", () => {
  beforeEach(() => {
    rpcCallMock.mockReset();
    rpcCallMock.mockResolvedValue(undefined);
    vi.stubGlobal("innerWidth", 1200);
    localStorage.clear();
  });

  it("defaults to the preset closest to the historical fixed width", () => {
    const store = createStore();
    expect(store.get(chatSplitRatioAtom)).toBe("one-third");
  });

  it("persists the pick and applies it to the pane in the same write", () => {
    const store = createStore();
    store.set(settingsAtom, getSettingsDefaults());
    store.set(chatWidthAtom, 480);

    store.set(chatSplitRatioAtom, "two-thirds");

    expect(store.get(chatSplitRatioAtom)).toBe("two-thirds");
    expect(store.get(settingsAtom)["general.chatPaneSplitRatio"]).toBe(
      "two-thirds"
    );
    expect(store.get(chatWidthAtom)).toBe(getChatWidthForRatio("two-thirds"));
  });

  it("leaves the divider free to be dragged away from the preset", () => {
    const store = createStore();
    store.set(chatSplitRatioAtom, "half");
    store.set(chatWidthAtom, 500);

    expect(store.get(chatWidthAtom)).toBe(500);
    expect(store.get(chatSplitRatioAtom)).toBe("half");
  });
});
