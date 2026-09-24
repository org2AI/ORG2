import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRustSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(
    /\/\/[^\n]*/gu,
    ""
  );
}

describe("desktop runtime bootstrap for Mobile Remote", () => {
  it("registers the runtime handle unconditionally before starting the API server", () => {
    const source = readRustSource("src-tauri/src/app/setup_hook/services.rs");

    // These consecutive startup statements must also execute in release builds.
    // A cfg(debug_assertions) here leaves production session/send, session/cancel
    // and interaction adapters with no AppHandle even while history reads work.
    expect(source).toMatch(
      /api::init_broadcaster\(ws_tx\.clone\(\)\);\s*api::init_app_handle\(app\.handle\(\)\.clone\(\)\);/u
    );
    expect(source.indexOf("api::init_app_handle(")).toBeLessThan(
      source.indexOf("api::start_server(")
    );
  });

  it("keeps test-only HTTP routes gated to debug builds", () => {
    const source = readRustSource("src-tauri/src/api/agent/mod.rs");

    expect(source).toMatch(/#\[cfg\(debug_assertions\)\]\s*pub mod test;/u);
    expect(source).toMatch(
      /#\[cfg\(debug_assertions\)\]\s*let router = router\s*\.route\("\/test\/message"/u
    );
  });
});
