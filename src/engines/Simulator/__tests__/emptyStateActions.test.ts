import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { openAgentSessionSearchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

import { createAgentStationQuickActions } from "../emptyStateActions";

vi.mock("@src/scaffold/GlobalSpotlight/openSpotlight", () => ({
  openAgentSessionSearchSpotlight: vi.fn(),
}));

const t = ((key: string) => key) as unknown as TFunction;

describe("createAgentStationQuickActions", () => {
  it("offers a session search action that opens the session search spotlight", () => {
    const actions = createAgentStationQuickActions({ t });

    expect(actions.map((action) => action.id)).toEqual(["search-sessions"]);
    expect(actions[0].label).toBe("commands.searchSessions");

    actions[0].onAction?.();
    expect(openAgentSessionSearchSpotlight).toHaveBeenCalledTimes(1);
  });
});
