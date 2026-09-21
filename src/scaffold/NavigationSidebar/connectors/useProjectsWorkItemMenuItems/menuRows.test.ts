import { describe, expect, it } from "vitest";

import { DeliveryBox01Icon } from "@src/icons";

import { buildProjectRow } from "./menuRows";

const t = ((key: string) => key) as Parameters<typeof buildProjectRow>[0];

describe("project rows", () => {
  it("uses the box icon for imported projects", () => {
    const row = buildProjectRow(
      t,
      "orgii-issues",
      "ORGII issues",
      false,
      "github"
    );

    expect(row.icon).toBe(DeliveryBox01Icon);
    expect(row.iconName).toBe("box");
    expect(row.iconElement).toBeUndefined();
    expect(row.visualTone).toBeUndefined();
  });

  it("keeps the default project icon for local projects", () => {
    const row = buildProjectRow(t, "local-project", "Local project");

    expect(row.icon).toBeDefined();
    expect(row.iconName).toBe("box");
    expect(row.iconElement).toBeUndefined();
    expect(row.visualTone).toBeUndefined();
  });
});
