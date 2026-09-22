import { formatTierModelLabel, isTierModelName } from "../modelTiers";

describe("isTierModelName", () => {
  it("matches the routing tiers regardless of case", () => {
    for (const name of ["default", "auto", "premium", "Default", "AUTO"]) {
      expect(isTierModelName(name)).toBe(true);
    }
  });

  it("does not match real model ids", () => {
    for (const name of ["composer-2.5", "gpt-5.4", "claude-opus-5-high"]) {
      expect(isTierModelName(name)).toBe(false);
    }
  });
});

describe("formatTierModelLabel", () => {
  it("names Cursor's auto-router for what it does", () => {
    expect(formatTierModelLabel("default", "cursor_cli")).toBe(
      "Auto (Cursor picks)"
    );
  });

  it("accepts the bare provider name as well as the key-vault model type", () => {
    // The Rust provider and the validate dispatch both say "cursor".
    expect(formatTierModelLabel("default", "cursor")).toBe(
      "Auto (Cursor picks)"
    );
  });

  it("labels Cursor's other tiers", () => {
    expect(formatTierModelLabel("auto", "cursor_cli")).toBe("Auto");
    expect(formatTierModelLabel("premium", "cursor_cli")).toBe("Premium");
  });

  it("leaves tiers unlabelled without a Cursor hint", () => {
    // "default" on a claude_code key means "whatever the CLI picks", not
    // Cursor's router — naming it for Cursor would be a lie.
    expect(formatTierModelLabel("default", "claude_code")).toBeUndefined();
    expect(formatTierModelLabel("default", "cursor_ide")).toBeUndefined();
    expect(formatTierModelLabel("default")).toBeUndefined();
  });

  it("returns nothing for ids that are not tiers", () => {
    expect(formatTierModelLabel("composer-2.5", "cursor_cli")).toBeUndefined();
  });
});
