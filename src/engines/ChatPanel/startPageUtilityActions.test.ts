import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { buildStartPageUtilityActions } from "./startPageUtilityActions";

const t = ((key: string) => key) as TFunction<
  ["sessions", "common", "projects", "navigation"]
>;

function build() {
  const options = {
    onAddApiKey: vi.fn(),
    setIsImportSessionDialogOpen: vi.fn(),
    setIsQuotaModalOpen: vi.fn(),
    t,
  };
  return { actions: buildStartPageUtilityActions(options), options };
}

describe("buildStartPageUtilityActions", () => {
  it("lists only import, API key and quota actions", () => {
    const { actions } = build();
    expect(actions.map((action) => [action.id, action.tone])).toEqual([
      ["import-session", "neutral"],
      ["add-api-key", "neutral"],
      ["show-quota", "neutral"],
    ]);
  });

  it("wires each action to its handler", () => {
    const { actions, options } = build();
    const byId = new Map(actions.map((action) => [action.id, action]));

    byId.get("import-session")?.onClick();
    byId.get("show-quota")?.onClick();

    expect(options.setIsImportSessionDialogOpen).toHaveBeenCalledWith(true);
    expect(options.setIsQuotaModalOpen).toHaveBeenCalledWith(true);
    expect(byId.get("add-api-key")?.onClick).toBe(options.onAddApiKey);
  });
});
