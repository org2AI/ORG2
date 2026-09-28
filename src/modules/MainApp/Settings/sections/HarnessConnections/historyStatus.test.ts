import { describe, expect, it } from "vitest";

import { historyReasonKey } from "./historyStatus";

describe("automatic native history reasons", () => {
  it("never renders arbitrary native diagnostics or credential-bearing paths", () => {
    for (const reason of [
      null,
      "",
      "/private/profile/config.json secret-token",
      "native_app_changed /private/path",
    ]) {
      expect(historyReasonKey(reason)).toBe(
        "harnessConnections.marketApps.historySync.reasons.unavailable"
      );
    }
  });
  it("distinguishes waiting for a writer from unknown compatibility and target routing", () => {
    expect(historyReasonKey("claude_history_waiting_for_exit")).toMatch(
      /\.waiting$/
    );
    expect(historyReasonKey("native_history_runtime_unknown")).toMatch(
      /\.compatibility$/
    );
    expect(historyReasonKey("target_route_unknown")).toMatch(/\.route$/);
  });
});
