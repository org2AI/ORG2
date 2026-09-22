import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNormalizedCache } from "@src/engines/SessionCore/core/store/snapshotMaterialization";
import { normalizePersistedTodoList } from "@src/engines/SessionCore/hooks/session/todoNormalization";

import { rpc } from "../router";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
afterEach(() => {
  vi.unstubAllEnvs();
  invokeMock.mockReset();
});
// Synthetic, non-private payloads transcribed from current Rust producers.
describe.each(["development", "production"])(
  "Rust RPC producer contracts in %s",
  (mode) => {
    it("accepts cached-session metadata with absent time range", async () => {
      vi.stubEnv("NODE_ENV", mode);
      const wire = {
        sessionId: "review",
        eventCount: 0,
        cachedAt: 1,
        contentRevision: 1,
        timeRangeStart: null,
        timeRangeEnd: null,
        specsJson: null,
      };
      invokeMock.mockResolvedValue(wire);
      await expect(
        rpc.sessionCore.cache.getSessionMetadata({ sessionId: "review" })
      ).resolves.toMatchObject({
        eventCount: 0,
        timeRangeStart: undefined,
        timeRangeEnd: undefined,
      });
      invokeMock.mockResolvedValue([wire]);
      await expect(
        rpc.sessionCore.cache.getAllSessions()
      ).resolves.toMatchObject([{ eventCount: 0, timeRangeStart: undefined }]);
    });
    it("accepts a full cached session without specs", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({
        sessionId: "review",
        events: [],
        specsJson: null,
        timeRangeStart: "2026-09-14",
        timeRangeEnd: "2026-09-14",
      });
      await expect(
        rpc.sessionCore.cache.loadFullSession({ sessionId: "review" })
      ).resolves.toMatchObject({ sessionId: "review" });
    });
    it("accepts QuestionManager pending metadata", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({
        pendingQuestions: [
          {
            requestId: "q1",
            sessionId: "review",
            questions: [
              {
                question: "Proceed?",
                header: "Confirm",
                options: [
                  { label: "Yes", description: "Proceed" },
                  { label: "No", description: "Stop" },
                ],
                multiSelect: false,
              },
            ],
            toolCallId: null,
            autoResolveAt: null,
          },
        ],
      });
      await expect(
        rpc.agentSession.getPendingQuestions({ sessionId: "review" })
      ).resolves.toMatchObject({
        pendingQuestions: [
          {
            requestId: "q1",
            toolCallId: undefined,
            autoResolveAt: null,
            questions: [
              {
                question: "Proceed?",
                header: "Confirm",
                options: [
                  { label: "Yes", description: "Proceed" },
                  { label: "No", description: "Stop" },
                ],
                multiSelect: false,
              },
            ],
          },
        ],
      });
    });
    it("accepts a persisted todo without activeForm", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue([
        {
          id: "persisted-0",
          index: 0,
          content: "Task",
          activeForm: null,
          status: "pending",
          priority: "medium",
        },
      ]);
      await expect(
        rpc.agentSession.getTodos({ sessionId: "review" })
      ).resolves.toEqual([
        {
          id: "persisted-0",
          content: "Task",
          activeForm: undefined,
          status: "pending",
        },
      ]);
    });
    it("preserves persisted todo dependencies", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue([
        {
          id: "persisted-1",
          index: 1,
          content: "Task",
          activeForm: "Working",
          status: "pending",
          priority: "medium",
          blockedBy: [0],
        },
      ]);
      const todos = await rpc.agentSession.getTodos({ sessionId: "review" });
      expect(normalizePersistedTodoList(todos)).toMatchObject([
        { blockedBy: [0] },
      ]);
    });
    it("accepts optional plan tool references", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({
        sessionId: "review",
        planPath: "plan.md",
        planTitle: "Plan",
        planContent: "Work",
        planId: "p1",
        planRevisionId: "r1",
        toolCallId: null,
        originToolCallId: null,
        autoApproveAt: null,
      });
      await expect(
        rpc.agentSession.getPendingPlanApproval({ sessionId: "review" })
      ).resolves.toMatchObject({
        planId: "p1",
        toolCallId: undefined,
        originToolCallId: undefined,
      });
      await expect(
        rpc.agentSession.updatePendingPlanContent({
          sessionId: "review",
          content: "Work",
        })
      ).resolves.toMatchObject({
        planId: "p1",
        toolCallId: undefined,
        originToolCallId: undefined,
      });
    });
    it("preserves snapshot metadata", async () => {
      vi.stubEnv("NODE_ENV", mode);
      const event = {
        id: "canvas1",
        chunk_id: null,
        sessionId: "review",
        createdAt: "2026-09-14T00:00:00Z",
        functionName: "render_inline_canvas",
        uiCanonical: "canvas_inline",
        actionType: "render",
        args: { mode: "html", title: "Preview" },
        result: {},
        source: "assistant",
        displayText: "Preview",
        displayStatus: "completed",
        displayVariant: "tool_call",
        activityStatus: "processed",
      };
      const {
        chunk_id: _chunk,
        args: _args,
        result: _result,
        ...previewFields
      } = event;
      const wire = {
        version: 1,
        eventCount: 1,
        events: [event],
        chatEvents: [event],
        messagesEvents: [],
        sortedSimulatorEvents: [event],
        lastEvent: event,
        eventIndex: { canvas1: 0 },
        chatEventCount: 1,
        hasRunningEvent: false,
        latestCanvasPreview: {
          eventId: "canvas1",
          mode: "html",
          title: "Preview",
        },
        sortedSimulatorEventIds: ["canvas1"],
        eventPreviewById: {
          canvas1: { ...previewFields, filterCategory: "other" },
        },
        createdAtById: { canvas1: event.createdAt },
        threadIdById: { canvas1: "thread1" },
        functionNameById: { canvas1: event.functionName },
        displayStatusById: { canvas1: event.displayStatus },
        displayVariantById: { canvas1: event.displayVariant },
      };
      invokeMock.mockResolvedValue(wire);
      const snapshot = await rpc.sessionCore.eventStore.getSnapshot({
        sessionId: "review",
      });
      expect(snapshot).toEqual(wire);
      // Full RPC hydration and pushed snapshots must feed identical consumer state.
      expect(buildNormalizedCache(snapshot)).toEqual(
        buildNormalizedCache(wire as typeof snapshot)
      );
    });
    it("accepts diff output after its configured transform", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({
        diff: "",
        stats: {
          lines_added: 0,
          lines_removed: 0,
          lines_unchanged: 1,
          hunks: 0,
        },
        processing_time_us: 1,
      });
      await expect(
        rpc.diff.computeDiff({ oldText: "a", newText: "a" })
      ).resolves.toEqual({
        diff: "",
        stats: { linesAdded: 0, linesRemoved: 0, linesUnchanged: 1, hunks: 0 },
        processingTimeUs: 1,
      });
    });
    it.each([
      [
        "applyPatch",
        { original: "a", patch: "" },
        {
          content: "a",
          success: true,
          hunks_applied: 0,
          hunks_failed: [
            { hunk_index: 0, expected_line: 1, reason: "context" },
          ],
          processing_time_us: 2,
        },
        {
          content: "a",
          success: true,
          hunksApplied: 0,
          hunksFailed: [{ hunkIndex: 0, expectedLine: 1, reason: "context" }],
          processingTimeUs: 2,
        },
      ],
      [
        "applyFuzzyPatch",
        { original: "a", patch: "" },
        {
          content: "a",
          success: true,
          hunks: [
            {
              hunk_index: 0,
              offset_applied: 1,
              similarity: 1,
              applied: true,
              reason: null,
            },
          ],
          processing_time_us: 2,
        },
        {
          content: "a",
          success: true,
          hunks: [
            {
              hunkIndex: 0,
              offsetApplied: 1,
              similarity: 1,
              applied: true,
              reason: null,
            },
          ],
          processingTimeUs: 2,
        },
      ],
      [
        "mergeThreeWay",
        { base: "a", ours: "a", theirs: "a" },
        { content: "a", clean: true, conflict_count: 0, processing_time_us: 2 },
        { content: "a", clean: true, conflictCount: 0, processingTimeUs: 2 },
      ],
    ] as const)(
      "decodes %s including nested fields",
      async (name, input, wire, expected) => {
        vi.stubEnv("NODE_ENV", mode);
        invokeMock.mockResolvedValue(wire);
        const result =
          name === "mergeThreeWay"
            ? rpc.diff.mergeThreeWay(input)
            : name === "applyPatch"
              ? rpc.diff.applyPatch(input)
              : rpc.diff.applyFuzzyPatch(input);
        await expect(result).resolves.toEqual(expected);
      }
    );
    // A CLI transcript's tool `input` is passed through verbatim by the
    // parsers and stored as unconstrained JSON, so a non-object `args` must
    // decode rather than fail the whole `cli_agent_chunks` read — the only
    // consumer is the cloud session-share push.
    it.each([
      ["null", null, {}],
      ["a bare string", "ls -la", { content: "ls -la", observation: "ls -la" }],
      ["an array", [1, 2], { value: [1, 2] }],
    ])(
      "decodes a persisted chunk whose args is %s",
      async (_label, args, expected) => {
        vi.stubEnv("NODE_ENV", mode);
        invokeMock.mockResolvedValue([
          {
            chunk_id: "c1",
            session_id: "review",
            action_type: "tool_call",
            function: "Bash",
            args,
            result: {},
            created_at: "2026-09-22T00:00:00Z",
          },
        ]);
        await expect(
          rpc.cli.chunks({ sessionId: "review" })
        ).resolves.toMatchObject([{ chunk_id: "c1", args: expected }]);
      }
    );

    // `ask_user_questions` now rejects these at the writer; decoding stays
    // tolerant so a batch already pending cannot break session-status recovery,
    // which the live `agent:question_request` channel renders without checking.
    it("decodes a pending batch whose question element is malformed", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue({
        pendingQuestions: [
          {
            requestId: "q1",
            sessionId: "review",
            questions: [
              "bare string",
              { header: "no question key" },
              { question: "Real?" },
            ],
            toolCallId: null,
            autoResolveAt: null,
          },
        ],
      });
      await expect(
        rpc.agentSession.getPendingQuestions({ sessionId: "review" })
      ).resolves.toMatchObject({
        pendingQuestions: [
          {
            requestId: "q1",
            questions: [
              { question: "bare string" },
              { header: "no question key" },
              { question: "Real?" },
            ],
          },
        ],
      });
    });

    it("continues rejecting malformed values after null normalization", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue([
        { id: "todo", content: "Task", status: "pending", activeForm: 42 },
      ]);
      await expect(
        rpc.agentSession.getTodos({ sessionId: "review" })
      ).rejects.toThrow("Invalid output");
      invokeMock.mockResolvedValue({
        sessionId: "review",
        events: [],
        specsJson: 42,
      });
      await expect(
        rpc.sessionCore.cache.loadFullSession({ sessionId: "review" })
      ).rejects.toThrow("Invalid output");
    });
  }
);
