import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionService } from "./SessionService";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@src/api/tauri/agent", async () => {
  const { rpc } = await import("@src/api/tauri/rpc");
  return {
    getSession: (sessionId: string) =>
      rpc.agentSession.getSession({ sessionId }),
    getPendingQuestions: (sessionId: string) =>
      rpc.agentSession.getPendingQuestions({ sessionId }),
  };
});
vi.mock("@src/config/routes", () => ({ ROUTES: {} }));
vi.mock("@src/engines/SessionCore/sync/types", () => ({}));
vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({ error: vi.fn() }),
}));
vi.mock("@src/router/navigateApp", () => ({}));
vi.mock("@src/services/context/collectors", () => ({}));
vi.mock("@src/store/session", () => ({}));
vi.mock("@src/store/session/sessionAtom", () => ({}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({}));
vi.mock("@src/util/platform/tauri/init", () => ({}));
vi.mock("@src/util/session/sessionDispatch", () => ({
  isAgentSession: () => true,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  invokeMock.mockReset();
});

describe.each(["development", "production"])(
  "SessionService pending question contract in %s",
  (mode) => {
    it.each([true, false])("reports pending batches: %s", async (pending) => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockImplementation(async (command) =>
        command === "agent_get_session"
          ? {
              sessionId: "agent-review",
              status: "running",
              createdAt: "2026-09-14",
              updatedAt: "2026-09-14",
            }
          : {
              pendingQuestions: pending
                ? [
                    {
                      requestId: "request-1",
                      sessionId: "agent-review",
                      questions: [
                        { question: "Which target?" },
                        { question: "Which branch?" },
                      ],
                      toolCallId: null,
                      autoResolveAt: null,
                    },
                  ]
                : [],
            }
      );
      await expect(
        SessionService.getStatus({ sessionId: "agent-review" })
      ).resolves.toEqual({
        sessionId: "agent-review",
        status: pending ? "waiting_for_user" : "running",
        waitingFor: pending ? "question_answer" : null,
        pendingQuestions: pending
          ? [
              {
                questionId: "request-1",
                questionText: "Which target?\nWhich branch?",
              },
            ]
          : [],
        pendingQuestionsCount: pending ? 1 : 0,
      });
      expect(invokeMock).toHaveBeenCalledWith("agent_get_pending_questions", {
        sessionId: "agent-review",
      });
    });
  }
);
