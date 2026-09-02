import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  type ActiveConversationRunner,
  activeConversationRunnerKey,
  buildConversationRunnerOverlay,
  collectLandedTurnIds,
  removeConversationRunnerByTurn,
  selectActiveRunners,
  selectConversationRunnerTail,
  upsertConversationRunner,
} from "./activeConversationRunnersAtom";

const row = (turnId: string, source: "user" | "assistant" | "system") => ({
  turnId,
  event: { source },
});

describe("collectLandedTurnIds", () => {
  it("ignores the user row pushed ahead of the runner", () => {
    expect(collectLandedTurnIds([row("t1", "user")])).toEqual(new Set());
  });

  it("marks a turn landed once any agent row is on the plane", () => {
    expect(
      collectLandedTurnIds([
        row("t1", "user"),
        row("t2", "user"),
        row("t1", "assistant"),
      ])
    ).toEqual(new Set(["t1"]));
    expect(collectLandedTurnIds([row("t3", "system")])).toEqual(
      new Set(["t3"])
    );
  });
});

describe("selectActiveRunners", () => {
  const runners = [
    { runnerSessionId: "r1", turnId: "t1", eventStartIndex: 8 },
    { runnerSessionId: "r2", turnId: "t2", eventStartIndex: 0 },
  ];

  it("keeps a runner while only its user row is on the plane", () => {
    const landed = collectLandedTurnIds([row("t1", "user"), row("t2", "user")]);
    expect(selectActiveRunners(runners, landed)).toEqual(runners);
  });

  it("drops a runner once its agent tail landed", () => {
    const landed = collectLandedTurnIds([
      row("t1", "user"),
      row("t1", "assistant"),
      row("t2", "user"),
    ]);
    expect(selectActiveRunners(runners, landed)).toEqual([runners[1]]);
  });
});

describe("selectConversationRunnerTail", () => {
  it("windows a reused native session to the current non-user tail", () => {
    const events = [
      { id: "old-agent", source: "assistant" },
      { id: "current-user", source: "user" },
      { id: "current-tool", source: "system" },
      { id: "current-agent", source: "assistant" },
    ] as unknown as SessionEvent[];
    expect(
      selectConversationRunnerTail(
        { runnerSessionId: "r1", turnId: "t1", eventStartIndex: 1 },
        events
      ).map((event) => event.id)
    ).toEqual(["current-tool", "current-agent"]);
  });

  it("builds the production overlay from only that windowed tail", () => {
    const events = [
      { id: "old-agent", chunk_id: "old-agent", source: "assistant" },
      { id: "current-user", chunk_id: "current-user", source: "user" },
      { id: "current-agent", chunk_id: "current-agent", source: "assistant" },
    ] as unknown as SessionEvent[];
    expect(
      buildConversationRunnerOverlay(
        { runnerSessionId: "r1", turnId: "t1", eventStartIndex: 1 },
        events,
        "canonical-root"
      )
    ).toEqual([
      expect.objectContaining({
        id: "runlive-current-agent",
        chunk_id: "runlive-current-agent",
        sessionId: "canonical-root",
      }),
    ]);
  });
});

describe("removeConversationRunnerByTurn", () => {
  it("drops only the empty terminal turn and removes an empty root bucket", () => {
    const registry = {
      root: [
        { runnerSessionId: "r1", turnId: "t1", eventStartIndex: 1 },
        { runnerSessionId: "r2", turnId: "t2", eventStartIndex: 2 },
      ],
    };
    expect(removeConversationRunnerByTurn(registry, "root", "t1")).toEqual({
      root: [{ runnerSessionId: "r2", turnId: "t2", eventStartIndex: 2 }],
    });
    expect(
      removeConversationRunnerByTurn({ root: [registry.root[0]] }, "root", "t1")
    ).toEqual({});
  });
});

describe("active conversation runner registry identity and bounds", () => {
  const root = (conversationId: string) => ({
    authority: "org2-cloud",
    authorityScope: ["org-1"],
    conversationId,
  });

  it("partitions runners by the exact auth identity and canonical root", () => {
    const authARoot1 = activeConversationRunnerKey("auth-a", root("root-1"));
    const authBRoot1 = activeConversationRunnerKey("auth-b", root("root-1"));
    const authARoot2 = activeConversationRunnerKey("auth-a", root("root-2"));

    expect(authARoot1).not.toBe(authBRoot1);
    expect(authARoot1).not.toBe(authARoot2);

    const first = {
      runnerSessionId: "runner-a",
      turnId: "turn-a",
      eventStartIndex: 0,
    };
    const second = {
      runnerSessionId: "runner-b",
      turnId: "turn-b",
      eventStartIndex: 0,
    };
    const registry = upsertConversationRunner(
      upsertConversationRunner({}, authARoot1, first),
      authBRoot1,
      second
    );

    expect(registry[authARoot1]).toEqual([first]);
    expect(registry[authBRoot1]).toEqual([second]);
    expect(registry[authARoot2]).toBeUndefined();
  });

  it("bounds both runners per root and remembered root buckets", () => {
    const key = activeConversationRunnerKey("auth-a", root("busy-root"));
    let registry: Record<string, ActiveConversationRunner[]> = {};
    for (let index = 0; index < 9; index += 1) {
      registry = upsertConversationRunner(registry, key, {
        runnerSessionId: `runner-${index}`,
        turnId: `turn-${index}`,
        eventStartIndex: index,
      });
    }
    expect(registry[key]).toHaveLength(8);
    expect(registry[key]?.[0]?.runnerSessionId).toBe("runner-1");

    for (let index = 0; index < 33; index += 1) {
      const rootKey = activeConversationRunnerKey(
        "auth-a",
        root(`root-${index}`)
      );
      registry = upsertConversationRunner(registry, rootKey, {
        runnerSessionId: `root-runner-${index}`,
        turnId: `root-turn-${index}`,
        eventStartIndex: 0,
      });
    }
    expect(Object.keys(registry)).toHaveLength(32);
    expect(
      registry[activeConversationRunnerKey("auth-a", root("root-0"))]
    ).toBeUndefined();
    expect(
      registry[activeConversationRunnerKey("auth-a", root("root-32"))]
    ).toHaveLength(1);
  });
});
