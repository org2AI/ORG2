import { describe, expect, it } from "vitest";

import {
  hasValidSessionPresentation,
  isSessionSearchRows,
} from "./sessionDiscoveryContract";

describe("mobile session presentation ingestion", () => {
  const row = { id: "native", name: "Name", status: "idle" };
  it("accepts old Desktop rows and bounded optional metadata", () => {
    expect(isSessionSearchRows([row])).toBe(true);
    expect(
      isSessionSearchRows([
        {
          ...row,
          lifecycleStatus: "waiting_for_user",
          display: { model: "gpt-5", agentDefinitionId: "builtin:sde" },
        },
      ])
    ).toBe(true);
    expect(
      isSessionSearchRows([{ ...row, lifecycleStatus: "future_phase" }])
    ).toBe(true);
  });
  it.each([
    { display: [] },
    { display: { model: 42 } },
    { display: { model: "x".repeat(513) } },
    { lifecycleStatus: {} },
  ])(
    "rejects invalid presentation at both list and search boundaries: %j",
    (fields) => {
      expect(hasValidSessionPresentation({ ...row, ...fields })).toBe(false);
      expect(isSessionSearchRows([{ ...row, ...fields }])).toBe(false);
    }
  );
});
