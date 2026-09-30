import { expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  projectSubagentParentDetails,
  subagentTaskTitleFromEvent,
} from "../subagentParentEventProjection";

const event = (overrides: Partial<SessionEvent> = {}) =>
  ({
    actionType: "tool_call",
    functionName: "subagent",
    args: { subagentSessionId: "child", description: "Inspect parser" },
    ...overrides,
  }) as SessionEvent;

it("requires an explicit child link on a canonical delegation event", () => {
  const details = projectSubagentParentDetails([
    event({ args: { description: "No child" } }),
    event({ functionName: "other" }),
    event({ actionType: "assistant_message" }),
    event({
      args: {},
      result: { subagentSessionId: "linked", summary: "Verified" },
    }),
  ]);
  expect([...details]).toEqual([
    ["linked", { title: undefined, summary: "Verified" }],
  ]);
});

it("prefers the explicit short description but keeps simulator prompt precedence", () => {
  const input = event({
    args: {
      subagentSessionId: "child",
      description: "Inspect parser",
      prompt: "Inspect the complete parser and report findings",
    },
    result: { summary: "Fixed empty window" },
  });
  expect(projectSubagentParentDetails([input]).get("child")).toEqual({
    title: "Inspect parser",
    summary: "Fixed empty window",
  });
  expect(subagentTaskTitleFromEvent(input)).toBe(
    "Inspect the complete parser and report findings"
  );
});

it("merges real later results without replacing the original assignment or inventing absent summaries", () => {
  expect(projectSubagentParentDetails([event()]).get("child")).toEqual({
    title: "Inspect parser",
    summary: undefined,
  });
  expect(
    projectSubagentParentDetails([
      event(),
      event({
        args: { subagentSessionId: "child" },
        result: { summary: "Done" },
      }),
      event({
        args: { subagentSessionId: "child" },
        result: { summary: "", content: "Final result" },
      }),
    ]).get("child")
  ).toEqual({ title: "Inspect parser", summary: "Final result" });
});
