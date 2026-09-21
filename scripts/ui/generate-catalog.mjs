// Run with node --experimental-strip-types scripts/ui/generate-catalog.mjs [--check].
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { uiCatalog } from "../../src/scaffold/ActionSystem/publicUi/catalog.ts";

const hash = createHash("sha256")
  .update(JSON.stringify(uiCatalog))
  .digest("hex");
const output = JSON.stringify({ ...uiCatalog, hash }, null, 2) + "\n";
const path = new URL(
  "../../src-tauri/crates/app-ui/catalog.json",
  import.meta.url
);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output)
    throw new Error("UI catalog is stale: regenerate it");
} else writeFileSync(path, output);
console.log(
  `UI catalog: ${uiCatalog.commands.length} commands, ${hash.slice(0, 12)}`
);
