import { describe, expect, it } from "vitest";

import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";

import type { ConsolidatedModelRow } from "../../../Tables/types";
import {
  buildIntegrationsModelGroups,
  unanimousGroupAgentType,
} from "./integrationsModelGroups";

function row(model: string, ...modelTypes: ModelType[]): ConsolidatedModelRow {
  return {
    model,
    sources: modelTypes.map((modelType) => ({
      source: modelType,
      modelType,
      keys: 1,
      enabledKeys: 0,
      enabled: false,
    })),
    totalKeys: modelTypes.length,
    allEnabled: false,
    someEnabled: false,
    isOlder: false,
  };
}

function labelOf(rows: ConsolidatedModelRow[], model: string): string {
  const group = buildIntegrationsModelGroups(rows).find((candidate) =>
    candidate.models.some((candidateRow) => candidateRow.model === model)
  );
  if (!group) throw new Error(`no group for ${model}`);
  return group.label;
}

describe("unanimousGroupAgentType", () => {
  it("returns the agent when every source agrees", () => {
    expect(unanimousGroupAgentType([row("default", "cursor_cli")])).toBe(
      "cursor_cli"
    );
  });

  it("returns nothing when the same model comes from two agents", () => {
    expect(
      unanimousGroupAgentType([row("default", "cursor_cli", "claude_code")])
    ).toBeUndefined();
  });

  it("returns nothing for an empty row set", () => {
    expect(unanimousGroupAgentType([])).toBeUndefined();
  });
});

describe("buildIntegrationsModelGroups tier labels", () => {
  it("names Cursor's auto-router instead of showing the raw id", () => {
    expect(labelOf([row("default", "cursor_cli")], "default")).toBe(
      "Auto (Cursor picks)"
    );
  });

  it("leaves the tier generic when another agent owns it", () => {
    expect(labelOf([row("default", "claude_code")], "default")).toBe("Default");
  });

  it("leaves the tier generic when two agents expose it", () => {
    // Nothing can be claimed about a tier that two agents route differently.
    expect(
      labelOf([row("default", "cursor_cli", "claude_code")], "default")
    ).toBe("Default");
  });

  it("does not touch labels of real models on a Cursor key", () => {
    expect(labelOf([row("composer-2.5", "cursor_cli")], "composer-2.5")).toBe(
      "Composer 2.5"
    );
  });
});
