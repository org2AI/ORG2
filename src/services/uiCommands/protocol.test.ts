import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { uiCatalog } from "@src/ActionSystem/publicUi/catalog";

import catalog from "../../../src-tauri/crates/app-ui/catalog.json";
import fixture from "../../../src-tauri/crates/app-ui/protocol.fixture.json";
import { requestSchema } from "./protocol";

describe("UI wire contract", () => {
  it("matches the same fixture Rust serializes", () => {
    expect(requestSchema.parse(fixture)).toEqual(fixture);
    expect(
      requestSchema.safeParse({ ...fixture, invokingSessionId: "forged" })
        .success
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        ...fixture,
        target: { ...fixture.target, station: "unknown" },
      }).success
    ).toBe(false);
  });
  it("keeps common help compact while preserving reference commands", () => {
    expect(
      uiCatalog.commands.filter((command) => command.discoveryTier === "common")
    ).toHaveLength(8);
    const reference = uiCatalog.commands.filter(
      (command) => command.discoveryTier === "reference"
    );
    expect(reference).toHaveLength(6);
    expect(reference.map((command) => command.id)).toContain(
      "ui.terminal.interrupt"
    );
  });
  it("keeps the bundled CLI catalog aligned with Zod definitions", () => {
    const { hash, ...bundled } = catalog;
    expect(hash).toBe(
      createHash("sha256").update(JSON.stringify(uiCatalog)).digest("hex")
    );
    expect(bundled).toEqual(uiCatalog);
  });
});
