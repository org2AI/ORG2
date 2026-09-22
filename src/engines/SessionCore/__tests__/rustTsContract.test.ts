/**
 * IPC contract exercised through the production registry initializer.
 * The fixture is serialized from Rust's static_tool_list + get_all_cli_aliases;
 * Rust's rust_tool_registry_matches_shared_frontend_contract test rejects drift
 * from this fixture.
 * Dynamic MCP tools are intentionally outside the static registry contract.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getAppTypeForEvent } from "../rendering/registry/constants";
import {
  _resetToolRegistry,
  getBuiltinToolIconId,
  getCliStorageCanonical,
  initToolRegistry,
  resolveCliAlias,
} from "../rendering/registry/initToolRegistry";
import { resolveToolName } from "../rendering/registry/toolAliases";

const { invokeMock } = vi.hoisted(() => {
  // Global setup imports the registry before file-local IPC mocks are applied.
  // Load a fresh production module so this test cannot reuse the setup maps.
  vi.resetModules();
  return { invokeMock: vi.fn() };
});
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: invokeMock }));

type AliasTuple = [string, string, string, string, string];
const wire = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "src/test/fixtures/tool-registry.rust.json"),
    "utf8"
  )
) as {
  tools: Array<{ name: string; icon_id: string; simulatorApp?: string }>;
  cli_aliases: Record<string, AliasTuple>;
};
const builtinApps = new Map(
  wire.tools
    .filter((tool) => tool.simulatorApp)
    .map((tool) => [tool.name, tool.simulatorApp])
);

beforeAll(async () => {
  _resetToolRegistry();
  invokeMock.mockResolvedValue(wire);
  await initToolRegistry();
});

describe("Rust registry serialization → production TypeScript initialization", () => {
  it("initializes from the real wire shape instead of global test maps", () => {
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("init_tool_registry");
    expect(wire.tools.length).toBeGreaterThan(0);
    expect(Object.keys(wire.cli_aliases).length).toBeGreaterThan(0);
  });

  for (const tool of wire.tools) {
    it(`preserves builtin metadata for ${tool.name}`, () => {
      expect(getBuiltinToolIconId(tool.name)).toBe(tool.icon_id || null);
      if (tool.simulatorApp) {
        expect(getAppTypeForEvent(tool.name)).toBe(tool.simulatorApp);
        expect(resolveToolName(tool.name)).toBe(tool.name);
      }
    });
  }

  for (const [
    alias,
    [storage, ui, simulatorApp, appSubtool, chatBlock],
  ] of Object.entries(wire.cli_aliases)) {
    it(`decodes all five alias fields for ${alias}`, () => {
      expect(resolveCliAlias(alias)).toEqual({
        storage,
        ui,
        simulatorApp,
        appSubtool,
        chatBlock,
      });
      expect(getCliStorageCanonical(alias)).toBe(storage);
      expect(resolveToolName(alias)).toBe(builtinApps.has(alias) ? alias : ui);
      expect(getAppTypeForEvent(alias)).toBe(
        builtinApps.get(alias) || simulatorApp || null
      );
    });
  }

  it("keeps storage canonical forms distinct from rendering canonical forms", () => {
    expect(resolveCliAlias("Edit")).toMatchObject({
      storage: "edit_file_by_replace",
      ui: "edit_file",
    });
    expect(resolveCliAlias("Write")).toMatchObject({
      storage: "create_file",
      ui: "edit_file",
    });
    expect(resolveCliAlias("Bash")).toMatchObject({
      storage: "run_command_line",
      ui: "run_shell",
    });
  });

  it("does not mistake unknown-name passthrough for a registered alias", () => {
    const unknown = "audit_unknown_tool_that_is_not_registered";
    expect(resolveToolName(unknown)).toBe(unknown);
    expect(resolveCliAlias(unknown)).toBeNull();
    expect(getAppTypeForEvent(unknown)).toBeNull();
  });
});
