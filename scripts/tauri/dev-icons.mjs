import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Retain only desktop assets; the Tauri icon command also emits mobile icons.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = mkdtempSync(join(tmpdir(), "orgii-dev-icons-"));
const destination = join(root, "src-tauri/icons/dev");
try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "icon",
      join(root, "src/assets/appIcons/dev.svg"),
      "--output",
      output,
    ],
    { cwd: root, stdio: "inherit" }
  );
  mkdirSync(destination, { recursive: true });
  for (const name of [
    "icon.png",
    "icon.icns",
    "icon.ico",
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
  ]) {
    copyFileSync(join(output, name), join(destination, name));
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
