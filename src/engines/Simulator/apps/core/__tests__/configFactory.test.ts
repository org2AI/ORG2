/**
 * Config Factory Tests
 *
 * Tests for defineSimulatorAppConfig.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { AppType } from "@src/engines/Simulator/types/appTypes";

import { defineSimulatorAppConfig } from "../configFactory";
import type { SimulatorAppBaseState } from "../types";

// ============================================
// Test Helpers
// ============================================

function createMockEvent(
  id: string,
  functionName: string,
  createdAt: string = new Date().toISOString()
): SessionEvent {
  return {
    id,
    functionName,
    sessionId: "test-session",
    createdAt,
    args: {},
    result: {},
    source: "agent",
    displayStatus: "completed",
  } as unknown as SessionEvent;
}

// ============================================
// defineSimulatorAppConfig Tests
// ============================================

describe("defineSimulatorAppConfig", () => {
  interface TestState extends SimulatorAppBaseState {
    items: string[];
    selectedItem: string | null;
  }

  it("creates config with correct properties", () => {
    const config = defineSimulatorAppConfig<TestState>({
      appType: AppType.CODE_EDITOR,
      name: "Test App",
      icon: "Code",
      deriveState: () => ({ items: [], selectedItem: null }),
    });

    expect(config.id).toBe(AppType.CODE_EDITOR);
    expect(config.name).toBe("Test App");
    expect(config.icon).toBe("Code");
    expect(typeof config.matchesEvent).toBe("function");
    expect(typeof config.deriveState).toBe("function");
  });

  it("deriveState is called correctly", () => {
    const mockEvents = [
      createMockEvent("1", "read_file"),
      createMockEvent("2", "write_file"),
    ];

    const deriveState = (
      events: SessionEvent[],
      currentEventId: string | null
    ) => ({
      items: events.map((e) => e.id),
      selectedItem: currentEventId,
    });

    const config = defineSimulatorAppConfig<TestState>({
      appType: AppType.CODE_EDITOR,
      name: "Test App",
      icon: "Code",
      deriveState,
    });

    const state = config.deriveState(mockEvents, "2");

    expect(state.items).toEqual(["1", "2"]);
    expect(state.selectedItem).toBe("2");
  });
});
