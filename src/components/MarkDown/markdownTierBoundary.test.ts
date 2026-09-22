import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT, resolveSpecifier } from "@src/test/staticImportGraph";

/**
 * `components/MarkDown/` is tier 1: 51 files across ChatPanel, WorkStation,
 * DiscussionChannels, MobileRemote, ProjectManager, MainApp, Org2Cloud, the
 * wizard, spotlight and the simulator render through it. It used to import
 * ChatPanel blocks, Org2Cloud references, the CodeMirror palette and the
 * scaffold image overlay — nine edges pointing at four tiers above it, all of
 * them unavailable to the other 35 importers.
 *
 * Those are now extension slots (`./extensions`) that the owning tier fills at
 * app bootstrap, so the dependency points down. These tests pin that.
 */
const MARKDOWN_DIR = path.join(SRC_ROOT, "components/MarkDown");
const UP_TIER = /@src\/(engines|features|modules|scaffold)\//;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|scss)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("markdown renderer tier boundary", () => {
  it("names no tier above components/ anywhere in the directory", () => {
    // Deliberately a text scan, not a resolved graph: it also catches
    // type-only imports, `vi.mock` specifiers and dynamic `import()`, any of
    // which would put the renderer's own tests or chunks above tier 1.
    const offenders = sourceFiles(MARKDOWN_DIR)
      .map((file) => ({
        file: path.relative(SRC_ROOT, file),
        hits: readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => UP_TIER.test(line))
          .map((line) => line.trim()),
      }))
      .filter((entry) => entry.hits.length > 0)
      .map((entry) => `${entry.file}: ${entry.hits.join(" | ")}`);

    expect(offenders).toEqual([]);
  });

  it("resolves no specifier of its own to a file above components/", () => {
    // Resolved rather than textual, so a relative escape out of this
    // directory is caught too. Only the renderer's OWN edges are checked: what the
    // tier-1 modules it shares with the rest of the app import in turn is a
    // different boundary, owned elsewhere.
    const offenders: string[] = [];
    for (const file of sourceFiles(MARKDOWN_DIR)) {
      if (file.endsWith(".scss")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /["'](\.{1,2}\/[^"']*|@src\/[^"']*)["']/g
      )) {
        const resolved = resolveSpecifier(match[1], file);
        if (resolved === null) continue;
        const relative = path.relative(SRC_ROOT, resolved);
        if (/^(engines|features|modules|scaffold)\//.test(relative))
          offenders.push(`${path.relative(SRC_ROOT, file)} -> ${relative}`);
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});
