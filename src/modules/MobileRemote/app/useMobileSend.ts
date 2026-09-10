import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  type MobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import type { MobileSendAttachment } from "../connection/types";
import {
  type TranscriptLoadState,
  appendOptimisticUserMessage,
  confirmOptimisticUserRound,
  rollbackOptimisticUserMessage,
} from "../lib/transcriptLoadState";
import type { MobileRemoteRuntimePort } from "../platform/types";

export interface MobileSendStatus {
  sessionId: string;
  turnIntentId: string;
  phase:
    | "submitting"
    | "accepted"
    | "uncertain"
    | "completed"
    | "failed"
    | "cancelled";
  message?: string;
}

interface MobileTerminalSignal {
  sessionId: string;
  turnIntentId?: string;
  phase?: "completed" | "failed" | "cancelled";
  message?: string;
}

function isIndeterminateTransportError(error: unknown): boolean {
  const message = toMobileRpcError(error).message;
  return (
    message === "WebSocket closed" ||
    message === "WebSocket is not open" ||
    message === "RPC client closed" ||
    message.startsWith("RPC call timed out:")
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

export function terminalSignalFromBusEvent(
  params: Record<string, unknown> | undefined
): MobileTerminalSignal | null {
  const envelope = record(params?.envelope);
  if (!envelope) return null;
  const type = firstString(envelope.type);
  const payload = record(envelope.payload);
  const event = record(payload?.event);
  const eventResult = record(event?.result);
  const sessionId = firstString(
    params?.sessionId,
    envelope.sessionId,
    envelope.session_id,
    payload?.sessionId,
    payload?.session_id,
    event?.sessionId,
    event?.session_id
  );
  if (!sessionId || !type) return null;
  const turnIntentId = firstString(
    envelope.turnIntentId,
    envelope.turn_intent_id,
    payload?.turnIntentId,
    payload?.turn_intent_id,
    event?.turnIntentId,
    event?.turn_intent_id,
    eventResult?.turnIntentId,
    eventResult?.turn_intent_id
  );

  if (type === "code_session.history_changed") {
    return {
      sessionId,
      turnIntentId,
      phase: envelope.status === "turn_settled" ? "completed" : undefined,
    };
  }
  if (type === "agent:streaming_complete") {
    return { sessionId, turnIntentId, phase: "completed" };
  }
  if (type !== "code_session.status_changed") return null;

  const status = firstString(envelope.status, payload?.status);
  if (status === "completed") {
    return { sessionId, turnIntentId, phase: "completed" };
  }
  if (status === "cancelled") {
    return { sessionId, turnIntentId, phase: "cancelled" };
  }
  if (status === "failed") {
    return {
      sessionId,
      turnIntentId,
      phase: "failed",
      message: firstString(
        envelope.errorMessage,
        envelope.error_message,
        payload?.errorMessage,
        payload?.error_message
      ),
    };
  }
  return null;
}

export function useMobileSend({
  demoMode,
  runtime,
  model,
  requireWritableClient,
  setTranscript,
  onDemoSend,
}: {
  demoMode: boolean;
  runtime: MobileRemoteRuntimePort;
  model?: string;
  requireWritableClient: () => MobileRpcClient;
  setTranscript: Dispatch<SetStateAction<TranscriptLoadState>>;
  onDemoSend: (sessionId: string) => void;
}) {
  const [sendStatus, setSendStatus] = useState<MobileSendStatus | null>(null);
  const generationRef = useRef(0);
  const resetSend = useCallback(() => {
    generationRef.current += 1;
    setSendStatus(null);
  }, []);
  const receiveTerminal = useCallback((terminal: MobileTerminalSignal) => {
    const phase = terminal.phase;
    if (!phase || !terminal.turnIntentId) return;
    setSendStatus((current) =>
      current?.sessionId === terminal.sessionId &&
      current.turnIntentId === terminal.turnIntentId
        ? { ...current, phase, message: terminal.message }
        : current
    );
  }, []);
  const receiveSendStatus = useCallback(
    (params: Record<string, unknown> | undefined) => {
      const sessionId =
        typeof params?.sessionId === "string" ? params.sessionId : "";
      const turnIntentId =
        typeof params?.turnIntentId === "string" ? params.turnIntentId : "";
      const status = typeof params?.status === "string" ? params.status : "";
      const roundId =
        typeof params?.roundId === "string" ? params.roundId.trim() : "";
      if (!sessionId || !turnIntentId) return;
      const phase =
        status === "completed"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : "failed";
      setSendStatus((current) =>
        current?.sessionId === sessionId &&
        current.turnIntentId === turnIntentId
          ? {
              ...current,
              phase,
              message:
                typeof params?.message === "string"
                  ? params.message
                  : undefined,
            }
          : current
      );
      if (phase === "completed" && roundId) {
        setTranscript((current) =>
          confirmOptimisticUserRound(current, sessionId, turnIntentId, roundId)
        );
      } else if (phase === "failed" || phase === "cancelled") {
        setTranscript((current) =>
          rollbackOptimisticUserMessage(current, sessionId, turnIntentId)
        );
      }
      return sessionId;
    },
    [setTranscript]
  );
  const sendMessage = useCallback(
    async (
      sessionId: string,
      content: string,
      attachments: MobileSendAttachment[] = []
    ) => {
      const generation = generationRef.current;
      const trimmed = content.trim();
      if (!trimmed && attachments.length === 0) return;
      const turnIntentId = runtime.randomUUID();
      const optimisticPreview =
        trimmed ||
        attachments
          .map((attachment) => attachment.fileName?.trim())
          .filter(Boolean)
          .join(", ") ||
        "Photo";
      setSendStatus({
        sessionId,
        turnIntentId,
        phase: "submitting",
      });
      setTranscript((prev) =>
        appendOptimisticUserMessage(
          prev,
          sessionId,
          turnIntentId,
          optimisticPreview
        )
      );
      if (demoMode) {
        onDemoSend(sessionId);
        setSendStatus({
          sessionId,
          turnIntentId,
          phase: "completed",
        });
        return;
      }
      try {
        const selectedModel = model;
        await requireWritableClient().call<{
          execution?: string;
        }>("session/send", {
          sessionId,
          content: trimmed,
          turnIntentId,
          turnIntentSource: "mobile_remote",
          attachments,
          ...(selectedModel ? { model: selectedModel } : {}),
        });
        setSendStatus((current) =>
          current?.sessionId === sessionId &&
          current.turnIntentId === turnIntentId &&
          current.phase === "submitting"
            ? { ...current, phase: "accepted" }
            : current
        );
      } catch (error) {
        if (generation !== generationRef.current) return;
        const message = toMobileRpcError(error).message;
        const uncertain = isIndeterminateTransportError(error);
        if (!uncertain) {
          setTranscript((prev) =>
            rollbackOptimisticUserMessage(prev, sessionId, turnIntentId)
          );
        }
        setSendStatus((current) =>
          current?.sessionId === sessionId &&
          current.turnIntentId === turnIntentId
            ? {
                ...current,
                phase: uncertain ? "uncertain" : "failed",
                message,
              }
            : current
        );
        if (uncertain) return;
        throw error;
      }
    },
    [demoMode, runtime, requireWritableClient, model, onDemoSend, setTranscript]
  );

  return {
    sendStatus,
    resetSend,
    receiveTerminal,
    receiveSendStatus,
    sendMessage,
  };
}
