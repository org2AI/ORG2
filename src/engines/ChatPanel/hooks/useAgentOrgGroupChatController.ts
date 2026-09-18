import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_RUN_STATUS,
  type AgentOrgGroupConversationItem,
  type AgentOrgRunMemberView,
  type AgentOrgRunView,
  isAgentOrgGroupConversationItem,
  resumeAgentOrgRun,
  retryAgentOrgGroupDelivery,
  sendAgentOrgGroupChatMessage,
  sendAgentOrgGroupRootMessage,
  stopAgentOrgGroupDelivery,
} from "@src/api/tauri/agent";
import {
  GROUP_CHAT_MIXED_TARGETS_ERROR,
  type GroupChatOutgoing,
  resolveGroupChatOutgoing,
} from "@src/engines/ChatPanel/hooks/groupChatRouting";
import { SubmissionOutcomeUnknownError } from "@src/engines/ChatPanel/hooks/useInputArea/submissionErrors";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { createLogger } from "@src/hooks/logger";
import { claimPipelineSessionAtom } from "@src/store/session";
import { groupChatViewSessionIdAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";

import {
  type GroupChatRetryEnvelope,
  groupChatRetryRequest,
  isDurableGroupDeliveryOutcomeUnknown,
  isGroupRetryEnvelopeDurable,
} from "./agentOrgGroupChatRetry";
import {
  isDirectAgentOrgMemberView,
  shouldBlockPausedAgentOrgGroupChatSubmit,
  shouldRouteAgentOrgGroupChatSubmit,
  shouldUseAgentOrgMemberGroupTransport,
} from "./agentOrgGroupChatRouting";
import {
  getAgentOrgGroupProjectionSnapshot,
  useAgentOrgGroupProjection,
} from "./agentOrgGroupProjectionStore";

const logger = createLogger("AgentOrgGroupChat");

interface OptimisticGroupTurn {
  turnIntentId: string;
  item: AgentOrgGroupConversationItem;
}

interface GroupRootRetryEnvelope {
  turnIntentId: string;
  clientMessageId: string;
  content: string;
  displayText: string;
  images?: string[];
  targetMemberName: string;
}

interface UseAgentOrgGroupChatControllerOptions {
  sessionId: string;
  agentOrgRunView: AgentOrgRunView | null;
  currentAgentOrgMember: AgentOrgRunMemberView | null;
  refreshAgentOrgRunView: () => Promise<void>;
}

function optimisticItem(input: {
  ordinal: number;
  turnIntentId: string;
  route: "coordinator" | "member";
  targetMemberId: string;
  targetName: string;
  text: string;
  createdAt: string;
  sourceId: string | number;
}): OptimisticGroupTurn {
  return {
    turnIntentId: input.turnIntentId,
    item: {
      id: `optimistic:${input.turnIntentId}:${input.ordinal}`,
      kind: "user_message",
      order: {
        createdAt: input.createdAt,
        sourceRank: 20,
        stableSourceId: `optimistic:${input.turnIntentId}`,
        itemOrdinal: 0,
      },
      turnIntentId: input.turnIntentId,
      route: input.route,
      targetMemberId: input.targetMemberId,
      targetName: input.targetName,
      sourceRef:
        typeof input.sourceId === "number"
          ? { kind: "inbox", id: input.sourceId }
          : { kind: "event", id: input.sourceId },
      text: input.text,
      createdAt: input.createdAt,
      state: "queued",
      canStop: false,
    },
  };
}

export function useAgentOrgGroupChatController({
  sessionId,
  agentOrgRunView,
  currentAgentOrgMember,
  refreshAgentOrgRunView,
}: UseAgentOrgGroupChatControllerOptions) {
  const { t } = useTranslation("sessions");
  const claimPipelineSession = useSetAtom(claimPipelineSessionAtom);
  const groupChatViewSessionId = useAtomValue(groupChatViewSessionIdAtom);
  const setGroupChatViewSessionId = useSetAtom(groupChatViewSessionIdAtom);
  const groupChatDefaultAppliedRef = useRef<Set<string>>(new Set());
  const groupChatRetryEnvelopeRef = useRef<GroupChatRetryEnvelope | null>(null);
  const groupRootRetryEnvelopeRef = useRef<GroupRootRetryEnvelope | null>(null);
  const [optimisticTurns, setOptimisticTurns] = useState<OptimisticGroupTurn[]>(
    []
  );
  const [groupChatRetryError, setGroupChatRetryError] = useState<string | null>(
    null
  );
  const [isRetryingGroupChat, setIsRetryingGroupChat] = useState(false);
  const [isResumingGroupChat, setIsResumingGroupChat] = useState(false);
  const [actionPendingTurns, setActionPendingTurns] = useState<Set<string>>(
    () => new Set()
  );
  const actionPendingTurnsRef = useRef<Set<string>>(new Set());
  const [groupProjectionActionError, setGroupProjectionActionError] = useState<
    string | null
  >(null);

  const directMemberView = isDirectAgentOrgMemberView(currentAgentOrgMember);
  const groupRootSessionId = agentOrgRunView?.context.rootSessionId ?? null;
  const groupChatViewAvailable = groupRootSessionId !== null;
  const groupChatViewActive =
    groupChatViewAvailable &&
    groupChatViewSessionId === sessionId &&
    !directMemberView;
  // `sessionId` owns this ChatView surface. Group history and actions belong
  // to the Team's canonical Root even when the surface was opened from a
  // sidebar Member session.
  const groupChatSessionId = groupRootSessionId ?? sessionId;
  const runId = agentOrgRunView?.context.runId ?? null;
  const projection = useAgentOrgGroupProjection(
    runId,
    groupChatSessionId,
    groupChatViewActive
  );
  const refreshProjection = projection.refresh;
  const loadOlderProjection = projection.loadOlder;
  const agentOrgInteractionSessionId =
    currentAgentOrgMember?.sessionRuntime?.sessionId ?? sessionId;
  const queueSessionId = groupChatViewActive
    ? groupChatSessionId
    : agentOrgInteractionSessionId;

  useEffect(() => {
    setOptimisticTurns([]);
    groupChatRetryEnvelopeRef.current = null;
    groupRootRetryEnvelopeRef.current = null;
    setGroupChatRetryError(null);
    setIsRetryingGroupChat(false);
    actionPendingTurnsRef.current.clear();
    setActionPendingTurns(new Set());
    setGroupProjectionActionError(null);
  }, [sessionId]);

  useEffect(() => {
    const durableTurns = new Set(
      projection.items
        .filter(isAgentOrgGroupConversationItem)
        .map((item) => item.turnIntentId)
    );
    setOptimisticTurns((current) => {
      const remaining = current.filter(
        (pending) => !durableTurns.has(pending.turnIntentId)
      );
      return remaining.length === current.length ? current : remaining;
    });
    const retryEnvelope = groupChatRetryEnvelopeRef.current;
    const rootRetryEnvelope = groupRootRetryEnvelopeRef.current;
    if (
      groupChatRetryError &&
      ((retryEnvelope &&
        isGroupRetryEnvelopeDurable(retryEnvelope, durableTurns)) ||
        (rootRetryEnvelope && durableTurns.has(rootRetryEnvelope.turnIntentId)))
    ) {
      groupChatRetryEnvelopeRef.current = null;
      groupRootRetryEnvelopeRef.current = null;
      setGroupChatRetryError(null);
    }
  }, [groupChatRetryError, projection.items]);

  const handleGroupChatViewToggle = useCallback(
    (active: boolean) => {
      groupChatDefaultAppliedRef.current.add(sessionId);
      if (active) {
        if (!groupRootSessionId) return;
        claimPipelineSession(groupRootSessionId);
      }
      setGroupChatViewSessionId(active ? sessionId : null);
    },
    [
      claimPipelineSession,
      groupRootSessionId,
      sessionId,
      setGroupChatViewSessionId,
    ]
  );

  useEffect(() => {
    if (!sessionId || !groupChatViewAvailable) return;
    if (groupChatDefaultAppliedRef.current.has(sessionId)) return;
    groupChatDefaultAppliedRef.current.add(sessionId);
    // A sidebar-opened Member must remain a direct-work surface until the
    // user explicitly chooses Group. Mark the default as considered so a
    // later Coordinator selection cannot accidentally reveal Group.
    if (directMemberView) return;
    setGroupChatViewSessionId(sessionId);
  }, [
    directMemberView,
    groupChatViewAvailable,
    sessionId,
    setGroupChatViewSessionId,
  ]);

  useEffect(() => {
    if (groupChatViewActive && !groupChatViewAvailable) {
      setGroupChatViewSessionId(null);
    }
  }, [groupChatViewActive, groupChatViewAvailable, setGroupChatViewSessionId]);

  const groupProjectionItems = useMemo(
    // The backend/Store order is the canonical context-sequence order. Local
    // optimistic Turns are newer submissions, so append them without
    // re-sorting by wall-clock timestamps (which are not a causal key).
    () => [
      ...projection.items,
      ...optimisticTurns.map((pending) => pending.item),
    ],
    [optimisticTurns, projection.items]
  );

  const groupChatMentionOptions = useMemo<ReadonlyArray<CustomMentionOption>>(
    () =>
      groupChatViewActive
        ? (agentOrgRunView?.members ?? []).map((member) => ({
            id: member.memberId,
            label: member.name,
            description: member.isCoordinator ? "Coordinator" : member.role,
          }))
        : [],
    [agentOrgRunView?.members, groupChatViewActive]
  );

  const groupChatRunPaused =
    groupChatViewActive &&
    agentOrgRunView?.runStatus === AGENT_ORG_RUN_STATUS.PAUSED;

  const handleResumeGroupChatRun = useCallback(async () => {
    if (!groupRootSessionId || isResumingGroupChat) return;
    setIsResumingGroupChat(true);
    try {
      await resumeAgentOrgRun(groupRootSessionId);
      await Promise.all([refreshAgentOrgRunView(), refreshProjection()]);
    } catch (error: unknown) {
      logger.error("Failed to resume Agent Team run from Group:", error);
    } finally {
      setIsResumingGroupChat(false);
    }
  }, [
    groupRootSessionId,
    isResumingGroupChat,
    refreshAgentOrgRunView,
    refreshProjection,
  ]);

  const handleGroupChatSubmitOverride = useCallback(
    async (input: SubmitOverrideInput): Promise<boolean> => {
      if (!agentOrgRunView) return false;
      if (
        !shouldRouteAgentOrgGroupChatSubmit(
          groupChatViewActive,
          directMemberView,
          input.memberMentions?.length ?? 0
        )
      ) {
        return false;
      }
      let route: GroupChatOutgoing;
      try {
        route = resolveGroupChatOutgoing(
          {
            displayText: input.displayText,
            memberMentions: input.memberMentions ?? [],
            displayTextWithoutMemberMentions:
              input.displayTextWithoutMemberMentions ?? input.displayText,
            agentContentWithoutMemberMentions:
              input.agentContentWithoutMemberMentions ??
              input.displayTextWithoutMemberMentions ??
              input.agentContent ??
              input.displayText,
          },
          agentOrgRunView.members
        );
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === GROUP_CHAT_MIXED_TARGETS_ERROR
        ) {
          throw new Error(t("groupChat.mixedTargetError"));
        }
        logger.error("Failed to resolve Agent Team Group targets:", error);
        throw new Error(t("groupChat.submitError"));
      }
      if (!route.agentBody.trim()) throw new Error(t("groupChat.submitError"));
      if (
        shouldBlockPausedAgentOrgGroupChatSubmit(
          agentOrgRunView.runStatus,
          route.targetMemberIds
        )
      ) {
        throw new Error(t("groupChat.pausedBanner.body"));
      }

      const createdAt = new Date().toISOString();
      if (!shouldUseAgentOrgMemberGroupTransport(route.targetMemberIds)) {
        const coordinator = agentOrgRunView.members.find(
          (member) => member.isCoordinator
        );
        if (!coordinator) throw new Error(t("groupChat.submitError"));
        const turnIntentId = crypto.randomUUID();
        const clientMessageId = `group-root-${crypto.randomUUID()}`;
        const rootEnvelope: GroupRootRetryEnvelope = {
          turnIntentId,
          clientMessageId,
          content: route.agentBody,
          displayText: route.displayText,
          images: input.imageDataUrls?.slice(),
          targetMemberName: coordinator.name,
        };
        const pending = optimisticItem({
          ordinal: 0,
          turnIntentId,
          route: "coordinator",
          targetMemberId: coordinator.memberId,
          targetName: coordinator.name,
          text: route.agentBody,
          createdAt,
          sourceId: `user-message-${clientMessageId}`,
        });
        setOptimisticTurns((current) => [...current, pending]);
        try {
          await sendAgentOrgGroupRootMessage({
            sessionId: groupChatSessionId,
            turnIntentId,
            clientMessageId,
            content: route.agentBody,
            displayText: route.displayText,
            images: input.imageDataUrls,
          });
          await refreshProjection();
          return true;
        } catch (error: unknown) {
          // A response can be lost after the backend has durably admitted the
          // Turn. Read the exact run projection back before deciding whether
          // the submission failed; if the read itself is unavailable, retain
          // the original ids so the visible Retry is idempotent.
          await refreshProjection();
          const readBack = getAgentOrgGroupProjectionSnapshot(
            agentOrgRunView.context.runId
          );
          if (
            readBack.items.some(
              (item) =>
                isAgentOrgGroupConversationItem(item) &&
                item.turnIntentId === rootEnvelope.turnIntentId
            )
          ) {
            return true;
          }
          if (readBack.error) {
            const reason =
              error instanceof Error ? error.message : String(error);
            groupRootRetryEnvelopeRef.current = rootEnvelope;
            setGroupChatRetryError(reason || "group_delivery_outcome_unknown");
            throw new SubmissionOutcomeUnknownError(
              reason || "group_delivery_outcome_unknown"
            );
          }
          setOptimisticTurns((current) =>
            current.filter((item) => item.turnIntentId !== turnIntentId)
          );
          logger.error("Failed to send Coordinator Group message:", error);
          throw new Error(t("groupChat.submitError"));
        }
      }

      const targets = route.targetMemberIds.map((memberId) => {
        const member = agentOrgRunView.members.find(
          (candidate) => candidate.memberId === memberId
        );
        if (!member || member.isCoordinator)
          throw new Error(t("groupChat.submitError"));
        return member;
      });
      const fingerprint = JSON.stringify({
        targets: route.targetMemberIds,
        body: route.agentBody,
        displayText: route.displayText,
        images: input.imageDataUrls ?? [],
      });
      let envelope = groupChatRetryEnvelopeRef.current;
      if (!envelope || envelope.fingerprint !== fingerprint) {
        envelope = {
          fingerprint,
          deliveries: targets.map((member) => ({
            targetMemberId: member.memberId,
            turnIntentId: crypto.randomUUID(),
          })),
          content: route.agentBody,
          displayText: route.displayText,
          images: input.imageDataUrls?.slice(),
          targetMemberNames: targets.map((member) => member.name),
        };
        groupChatRetryEnvelopeRef.current = envelope;
      }
      const pending = envelope.deliveries.map((delivery, index) => {
        const target = targets.find(
          (member) => member.memberId === delivery.targetMemberId
        );
        if (!target) throw new Error(t("groupChat.submitError"));
        return optimisticItem({
          ordinal: index,
          turnIntentId: delivery.turnIntentId,
          route: "member",
          targetMemberId: target.memberId,
          targetName: target.name,
          text: route.agentBody,
          createdAt,
          sourceId: -(index + 1),
        });
      });
      setOptimisticTurns((current) => [
        ...current.filter(
          (item) =>
            !pending.some(
              (candidate) => candidate.turnIntentId === item.turnIntentId
            )
        ),
        ...pending,
      ]);
      try {
        const request = groupChatRetryRequest(envelope);
        await sendAgentOrgGroupChatMessage(
          groupChatSessionId,
          request.deliveries,
          request.content,
          request.displayText,
          request.images
        );
        groupChatRetryEnvelopeRef.current = null;
        setGroupChatRetryError(null);
        await refreshProjection();
        return true;
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!isDurableGroupDeliveryOutcomeUnknown(error)) {
          groupChatRetryEnvelopeRef.current = null;
          setOptimisticTurns((current) =>
            current.filter(
              (item) =>
                !pending.some(
                  (candidate) => candidate.turnIntentId === item.turnIntentId
                )
            )
          );
          logger.error("Failed to send Member Group message:", error);
          throw new Error(t("groupChat.submitError"));
        }
        setGroupChatRetryError(reason || "group_delivery_outcome_unknown");
        throw new SubmissionOutcomeUnknownError(
          reason || "group_delivery_outcome_unknown"
        );
      }
    },
    [
      agentOrgRunView,
      directMemberView,
      groupChatViewActive,
      groupChatSessionId,
      refreshProjection,
      t,
    ]
  );

  const handleRetryGroupChatMessage = useCallback(async () => {
    const envelope = groupChatRetryEnvelopeRef.current;
    const rootEnvelope = groupRootRetryEnvelopeRef.current;
    if ((!envelope && !rootEnvelope) || isRetryingGroupChat) return;
    setIsRetryingGroupChat(true);
    try {
      if (rootEnvelope) {
        await sendAgentOrgGroupRootMessage({
          sessionId: groupChatSessionId,
          turnIntentId: rootEnvelope.turnIntentId,
          clientMessageId: rootEnvelope.clientMessageId,
          content: rootEnvelope.content,
          displayText: rootEnvelope.displayText,
          images: rootEnvelope.images,
        });
      } else if (envelope) {
        const request = groupChatRetryRequest(envelope);
        await sendAgentOrgGroupChatMessage(
          groupChatSessionId,
          request.deliveries,
          request.content,
          request.displayText,
          request.images
        );
      }
      groupChatRetryEnvelopeRef.current = null;
      groupRootRetryEnvelopeRef.current = null;
      setGroupChatRetryError(null);
      await refreshProjection();
    } catch (error: unknown) {
      setGroupChatRetryError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsRetryingGroupChat(false);
    }
  }, [groupChatSessionId, isRetryingGroupChat, refreshProjection]);

  const withPendingAction = useCallback(
    async (turnIntentId: string, action: () => Promise<void>) => {
      if (actionPendingTurnsRef.current.has(turnIntentId)) return;
      actionPendingTurnsRef.current.add(turnIntentId);
      setActionPendingTurns((current) => new Set(current).add(turnIntentId));
      setGroupProjectionActionError(null);
      try {
        await action();
        await refreshProjection();
      } catch (error: unknown) {
        setGroupProjectionActionError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        actionPendingTurnsRef.current.delete(turnIntentId);
        setActionPendingTurns((current) => {
          const next = new Set(current);
          next.delete(turnIntentId);
          return next;
        });
      }
    },
    [refreshProjection]
  );

  const handleStopGroupDelivery = useCallback(
    (item: AgentOrgGroupConversationItem) =>
      withPendingAction(item.turnIntentId, async () => {
        await stopAgentOrgGroupDelivery({
          sessionId: groupChatSessionId,
          turnIntentId: item.turnIntentId,
        });
      }),
    [groupChatSessionId, withPendingAction]
  );

  const handleRetryGroupDelivery = useCallback(
    (item: AgentOrgGroupConversationItem) =>
      withPendingAction(item.turnIntentId, async () => {
        const acknowledgePossibleDuplicate =
          item.retryMode === "new_turn_with_confirmation"
            ? window.confirm(t("groupChat.retryPossibleDuplicateConfirm"))
            : false;
        if (
          item.retryMode === "new_turn_with_confirmation" &&
          !acknowledgePossibleDuplicate
        ) {
          return;
        }
        await retryAgentOrgGroupDelivery({
          sessionId: groupChatSessionId,
          sourceTurnIntentId: item.turnIntentId,
          retryTurnIntentId:
            item.retryMode === "rekick" ? undefined : crypto.randomUUID(),
          acknowledgePossibleDuplicate,
        });
      }),
    [groupChatSessionId, t, withPendingAction]
  );

  const groupChatPendingMessage = useMemo(() => {
    const envelope = groupChatRetryEnvelopeRef.current;
    const rootEnvelope = groupRootRetryEnvelopeRef.current;
    if (!groupChatRetryError || (!envelope && !rootEnvelope)) return null;
    return {
      targetMemberName: rootEnvelope
        ? rootEnvelope.targetMemberName
        : envelope && envelope.targetMemberNames.length > 1
          ? t("groupChat.memberCount", {
              count: envelope.targetMemberNames.length,
            })
          : (envelope?.targetMemberNames[0] ?? t("groupChat.memberFallback")),
      retryError: groupChatRetryError,
      retrying: isRetryingGroupChat,
      onRetry: handleRetryGroupChatMessage,
    };
  }, [
    groupChatRetryError,
    handleRetryGroupChatMessage,
    isRetryingGroupChat,
    t,
  ]);

  return {
    agentOrgInteractionSessionId,
    queueSessionId,
    groupChatViewActive,
    groupChatViewAvailable,
    groupProjectionItems,
    groupProjectionHasMore: projection.hasMore,
    groupProjectionLoading: projection.loading || projection.loadingOlder,
    groupProjectionError: projection.error,
    groupProjectionActionError,
    actionPendingTurns,
    loadOlderGroupProjection: loadOlderProjection,
    retryGroupProjection: refreshProjection,
    handleStopGroupDelivery,
    handleRetryGroupDelivery,
    groupChatMentionOptions,
    groupChatRunPaused,
    groupChatPendingMessage,
    isResumingGroupChat,
    handleResumeGroupChatRun,
    handleGroupChatViewToggle,
    handleGroupChatSubmitOverride,
  };
}
