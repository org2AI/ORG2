import { execFileSync } from "node:child_process";

function pressMacKeyCode(keyCode, repeat = 1) {
  if (process.platform !== "darwin") {
    throw new Error("native keyboard transcript navigation is macOS-only");
  }
  const script = `tell application "System Events"
    repeat ${repeat} times
      key code ${keyCode}
      delay 0.03
    end repeat
  end tell`;
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
}

export async function focusTranscriptWithNativeTab({
  browser,
  execJS,
  testId,
  maxTabs = 80,
}) {
  for (let index = 0; index < maxTabs; index += 1) {
    const focusedInsideTranscript = await execJS(`
      return Boolean(
        document.activeElement?.closest?.(
          '[data-testid="${testId}"]'
        )
      );
    `);
    if (focusedInsideTranscript) return;
    pressMacKeyCode(48);
    await browser.pause(20);
  }
  throw new Error(`native Tab did not focus transcript ${testId}`);
}

export function pressNativePageUp(repeat = 1) {
  pressMacKeyCode(116, repeat);
}
