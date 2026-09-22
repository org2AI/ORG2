/**
 * Action-system bootstrap invariants.
 *
 * `src/scaffold/ActionSystem` owns the action mechanism (registry, schema,
 * dispatcher) and the app-level actions. `src/modules/WorkStation/actions` owns
 * the WorkStation surface and registers itself INTO the scaffold through
 * `coreActionProvider` — the scaffold never imports a module.
 *
 * These tests pin that inversion and prove it costs nothing: after bootstrap the
 * global registry holds exactly the app-level actions plus WorkStation's, with
 * the same handlers, and the composition root still installs the provider before
 * any `ActionSystemProvider` can mount.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import "@src/modules/WorkStation/actions/install";
import { getAllCoreZodActions } from "@src/modules/WorkStation/actions/registerCoreActions";
import { SRC_ROOT, walkStaticImports } from "@src/test/staticImportGraph";

import { collectAppZodActions } from "../../collectAppActions";
import { registerCoreActions } from "../../coreActionProvider";
import { registerAppActions } from "../../registerAppActions";
import { zodActionRegistry } from "../zodRegistry";

const TEST_REPO = "/tmp/orgii-action-bootstrap-test-repo";

const INSTALLER = "modules/WorkStation/actions/install.ts";

/** Every `.ts` / `.tsx` file under `dir`, recursively. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("action system bootstrap", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      cleanup();
    }
    expect(zodActionRegistry.getActionIds()).toEqual([]);
  });

  it("registers WorkStation's action set through the scaffold seam", () => {
    expect(zodActionRegistry.getActionIds()).toEqual([]);

    // Called exactly as `ActionSystemProvider` calls it — from the scaffold,
    // which does not know WorkStation exists.
    cleanups.push(registerCoreActions(TEST_REPO));

    const registered = new Set(zodActionRegistry.getActionIds());
    const expected = getAllCoreZodActions(TEST_REPO).map(
      (action) => action.meta.id
    );

    expect(expected.length).toBeGreaterThan(30);
    for (const actionId of expected) {
      expect(registered.has(actionId)).toBe(true);
    }
  });

  it("populates the full registry after bootstrap without losing an action id", () => {
    // Startup order: `registerAppActions` from the router root layout, then
    // `registerCoreActions` when the first ActionSystemProvider mounts.
    cleanups.push(registerAppActions());
    cleanups.push(registerCoreActions(TEST_REPO));

    const expected = new Set(
      [...collectAppZodActions(), ...getAllCoreZodActions(TEST_REPO)].map(
        (action) => action.meta.id
      )
    );

    expect(new Set(zodActionRegistry.getActionIds())).toEqual(expected);
  });

  it("keeps the same handler for an action registered through the seam", () => {
    cleanups.push(registerCoreActions(TEST_REPO));

    const viaSeam = zodActionRegistry.get("git.status");
    const viaWorkStation = getAllCoreZodActions(TEST_REPO).find(
      (action) => action.meta.id === "git.status"
    );

    expect(viaSeam).toBeDefined();
    expect(viaSeam?.execute).toBe(viaWorkStation?.execute);
  });

  it("installs the WorkStation provider from the app composition root", () => {
    const graph = walkStaticImports(["App.tsx"]);

    expect(
      graph.files.has(path.join(SRC_ROOT, INSTALLER)),
      "the composition root must import the WorkStation action installer, or the registry is empty at runtime"
    ).toBe(true);
  });

  it("never imports a module from the scaffold action system", () => {
    const root = path.join(SRC_ROOT, "scaffold/ActionSystem");
    const offenders = collectSourceFiles(root)
      .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
      .filter((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /(?:from|import)\s*\(?\s*["']([^"']+)["']/g
          ),
        ].some((match) => /(?:^|\/)modules\//.test(match[1]))
      )
      .map((file) => path.relative(SRC_ROOT, file));

    expect(
      offenders,
      "scaffold/ActionSystem must not import src/modules — surfaces register into it"
    ).toEqual([]);
  });
});
