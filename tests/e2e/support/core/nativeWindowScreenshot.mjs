import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The macOS WebDriver plugin rasterizes a cloned DOM through SVG foreignObject.
// That loses this app's styles; capture the actual isolated native window instead.
export function createNativeWindowScreenshot() {
  let helperRoot;
  let helper;
  return {
    async save(client, port, path) {
      if (process.platform !== "darwin") return client.saveScreenshot(path);
      const focused = await client.executeAsyncScript(
        `
        const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke('plugin:window|set_focus', {label:'main'})
          .then(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done({ok:true}), 150))))
          .catch(error => done({ok:false,error:String(error)}));
      `,
        []
      );
      if (!focused?.ok)
        throw new Error(
          `Could not focus native evidence window: ${focused?.error}`
        );
      if (!helper) {
        helperRoot = mkdtempSync(join(tmpdir(), "orgii-window-capture-"));
        const source = join(helperRoot, "windows.swift");
        helper = join(helperRoot, "windows");
        writeFileSync(
          source,
          `
import Foundation
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
let found = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
let data = try JSONSerialization.data(withJSONObject: found)
print(String(data:data,encoding:.utf8)!)
`
        );
        execFileSync("swiftc", [source, "-o", helper], { timeout: 60_000 });
      }
      const pids = execFileSync(
        "lsof",
        ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
        { encoding: "utf8" }
      )
        .trim()
        .split(/\s+/);
      if (pids.length !== 1 || !/^\d+$/.test(pids[0]))
        throw new Error(
          "Native screenshot requires exactly one isolated backend process"
        );
      const windows = JSON.parse(
        execFileSync(helper, [pids[0]], { encoding: "utf8" })
      );
      windows.sort(
        (a, b) =>
          b.kCGWindowBounds.Width * b.kCGWindowBounds.Height -
          a.kCGWindowBounds.Width * a.kCGWindowBounds.Height
      );
      const windowId = String(windows[0]?.kCGWindowNumber ?? "");
      if (!/^\d+$/.test(windowId))
        throw new Error("Isolated native window not found");
      execFileSync("screencapture", ["-x", "-l", windowId, path]);
    },
    cleanup() {
      if (helperRoot) rmSync(helperRoot, { recursive: true, force: true });
      helperRoot = undefined;
      helper = undefined;
    },
  };
}
