import fixture from "@/src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_terminal_error.json";
import { describe, expect, it } from "vitest";

import { projectNativeConversationItems } from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";
import { nativeSourceEventId } from "@src/engines/SessionCore/conversations/nativeSourceEventIdentity";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { CloudConversationEvent } from "../org2CloudConversationEventsClient";
import { mergePlaneIntoTranscript } from "./conversationTimeline";
import { reconcileLegacyTerminalIdentity } from "./legacyTerminalIdentity";

function history(intent = "failed-intent", sessionId = "runner") {
  const defaults = {
    sessionId,
    chunk_id: "fixture",
    uiCanonical: "error",
    displayText: "",
    displayStatus: "failed",
    displayVariant: "error",
    activityStatus: "processed",
    createdAt: "2026-09-24T20:00:00.000Z",
    args: {},
    result: {},
    payloadRefs: [],
  };
  return [
    {
      ...defaults,
      id: "user",
      source: "user",
      actionType: "raw",
      functionName: "user_message",
      result: {
        turnIntentId: intent,
        message: { role: "user", content: "continue" },
      },
    },
    { ...defaults, ...fixture.diagnostic, source: "system" },
    { ...defaults, ...fixture.failedLifecycle, id: "failed", source: "system" },
  ] as SessionEvent[];
}

function legacy(intent = "failed-intent"): CloudConversationEvent {
  return {
    id: "plane-row",
    rootSessionId: "shared-root",
    authorUserId: "owner",
    turnId: intent,
    seq: 1,
    createdAt: "2026-09-24T20:00:01.000Z",
    event: {
      ...history(intent)[1],
      id: `convturn-error-${intent}`,
      sessionId: "conversation",
      createdAt: "2026-09-24T20:00:01.000Z",
      actionType: "error",
      functionName: "error",
      source: "system",
      args: { conversationTurnId: intent },
      result: {
        error: fixture.diagnostic.result.error,
        success: false,
        turnIntentId: intent,
      },
    } as SessionEvent,
  };
}

const errors = (events: SessionEvent[]) =>
  events.filter((event) => event.actionType === "error");

describe("legacy terminal publication identity", () => {
  it("reconciles the historical writer envelope without changing either source", () => {
    const base = history();
    const row = legacy();
    const before = JSON.stringify({ base, row });
    const repaired = reconcileLegacyTerminalIdentity(base, [row]);
    expect(repaired[0].event.args.__orgiiSourceEventId).toBe(
      nativeSourceEventId(base[1])
    );
    const merged = mergePlaneIntoTranscript(base, [row], "shared-root");
    expect(errors(merged)).toEqual([
      expect.objectContaining({ id: base[1].id }),
    ]);
    expect(projectNativeConversationItems(merged)).toEqual(
      projectNativeConversationItems(base)
    );
    expect(JSON.stringify({ base, row })).toBe(before);
    expect(reconcileLegacyTerminalIdentity(base, repaired)).toBe(repaired);
    expect(
      errors(mergePlaneIntoTranscript(merged, [row], "shared-root"))
    ).toHaveLength(1);
  });

  it("keeps a standalone receiving client's failure until native proof arrives", () => {
    expect(
      errors(mergePlaneIntoTranscript([], [legacy()], "receiver"))
    ).toHaveLength(1);
    expect(
      errors(mergePlaneIntoTranscript(history(), [legacy()], "receiver"))
    ).toHaveLength(1);
  });

  it("never collapses equal error text from separate turns", () => {
    const base = [...history(), ...history("next-intent", "next-runner")];
    const rows = [legacy(), { ...legacy("next-intent"), id: "second", seq: 2 }];
    expect(
      errors(mergePlaneIntoTranscript(base, rows, "shared-root"))
    ).toHaveLength(2);
  });

  it.each([
    ["missing failed lifecycle", (base: SessionEvent[]) => base.slice(0, 2)],
    [
      "cross-session lifecycle",
      (base: SessionEvent[]) => [
        base[0],
        base[1],
        { ...base[2], sessionId: "other" },
      ],
    ],
    [
      "different intent",
      (base: SessionEvent[]) => [
        { ...base[0], result: { turnIntentId: "other" } },
        ...base.slice(1),
      ],
    ],
    [
      "two receipts",
      (base: SessionEvent[]) => [...base, { ...base[1], id: "second-receipt" }],
    ],
    [
      "ambiguous runner",
      (base: SessionEvent[]) => [...base, ...history("failed-intent", "other")],
    ],
    [
      "no typed provenance",
      (base: SessionEvent[]) => [base[0], { ...base[1], args: {} }, base[2]],
    ],
  ])("fails closed with %s", (_name, transform) => {
    const row = legacy();
    expect(
      reconcileLegacyTerminalIdentity(transform(history()), [row])[0]
    ).toBe(row);
  });

  it("does not alias a different dispatch error or an unrelated system event", () => {
    const row = legacy();
    const differentError = {
      ...row,
      event: {
        ...row.event,
        result: { ...row.event.result, error: "different dispatch failure" },
      },
    };
    const unrelated = { ...row, event: { ...row.event, id: "other-error" } };
    const wrongEnvelope = { ...row, turnId: "another-turn" };
    for (const candidate of [differentError, unrelated, wrongEnvelope]) {
      expect(reconcileLegacyTerminalIdentity(history(), [candidate])[0]).toBe(
        candidate
      );
    }
  });
});
