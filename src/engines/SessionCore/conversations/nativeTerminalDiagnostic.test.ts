import fixture from "@/src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_terminal_error.json";
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { nativeTurnFailureDiagnostic } from "./nativeTerminalDiagnostic";

describe("accepted terminal error provenance", () => {
  const user = {
    id: "user",
    sessionId: "runner",
    source: "user",
    result: { turnIntentId: "failed-intent" },
  } as unknown as SessionEvent;
  const diagnostic = {
    ...fixture.diagnostic,
    sessionId: "runner",
    source: "system",
  } as unknown as SessionEvent;
  const lifecycle = {
    ...fixture.failedLifecycle,
    sessionId: "runner",
  } as unknown as SessionEvent;
  it("preserves the exact typed failure of the accepted turn", () => {
    expect(
      nativeTurnFailureDiagnostic(
        [user, diagnostic, lifecycle],
        "failed-intent"
      )
    ).toBe(diagnostic);
  });
  it("does not borrow an old error or an unproven diagnostic", () => {
    const next = { ...user, result: { turnIntentId: "next" } };
    expect(
      nativeTurnFailureDiagnostic([user, diagnostic, lifecycle, next], "next")
    ).toBeUndefined();
    expect(
      nativeTurnFailureDiagnostic(
        [user, diagnostic, lifecycle, next],
        "failed-intent"
      )
    ).toBeUndefined();
    expect(
      nativeTurnFailureDiagnostic([user, diagnostic], "failed-intent")
    ).toBeUndefined();
  });
});
