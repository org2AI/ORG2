import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";

import {
  type ConversationSource,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import { loadLocalConversationExecutionTargets } from "@src/engines/SessionCore/conversations/localConversationContinuation";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session/sessionAtom";
import {
  conversationTargetOverridesAtom,
  reconcileConversationTargetOverrideAtom,
} from "@src/store/ui/conversationTargetAtom";

import { localConversationTargetFromSession } from "./conversationSourceResolution";
import {
  type ExecutionTargetHydration,
  conversationExecutions,
  resolveConversationExecutionTargetHydration,
} from "./executionTargetHydration";

const log = createLogger("useConversationTargetBinding");

interface UseConversationExecutionTargetsArgs {
  source: ConversationSource | undefined;
  sessions: readonly Session[];
}

/**
 * Hydrates the durable execution targets for the source root, merges them
 * with live Session rows and reconciles the picker override against the
 * persisted target.
 */
export function useConversationExecutionTargets({
  source,
  sessions,
}: UseConversationExecutionTargetsArgs) {
  const pickerOverrides = useAtomValue(conversationTargetOverridesAtom);
  const reconcilePickerOverride = useSetAtom(
    reconcileConversationTargetOverrideAtom
  );

  const sourceRootKey = source ? conversationRootKey(source.root) : null;
  const [executionTargetHydration, setExecutionTargetHydration] =
    useState<ExecutionTargetHydration | null>(null);
  useEffect(() => {
    const root = source?.root ?? null;
    if (!root || !sourceRootKey) {
      setExecutionTargetHydration(null);
      return;
    }

    let current = true;
    setExecutionTargetHydration({
      rootKey: sourceRootKey,
      status: "loading",
      targets: [],
    });
    void loadLocalConversationExecutionTargets(root)
      .then((targets) => {
        if (!current) return;
        setExecutionTargetHydration({
          rootKey: sourceRootKey,
          status: "ready",
          targets,
        });
      })
      .catch((error: unknown) => {
        if (!current) return;
        log.warn("durable execution target hydration failed", {
          rootKey: sourceRootKey,
          error,
        });
        setExecutionTargetHydration({
          rootKey: sourceRootKey,
          status: "error",
          targets: [],
        });
      });

    return () => {
      current = false;
    };
    // `sourceRootKey` encodes every locator field. Reloading on presentation
    // metadata or sessionsAtom changes would repeatedly hide a ready picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceRootKey]);
  const persistedExecutions = useMemo(
    () => (source ? conversationExecutions(sessions, source.root) : []),
    [sessions, source]
  );
  const liveExecutionTargets = useMemo(
    () =>
      persistedExecutions.flatMap((execution) => {
        const target = localConversationTargetFromSession(execution);
        return target
          ? [
              {
                sessionId: execution.session_id,
                updatedAt: execution.updated_at ?? "",
                target,
              },
            ]
          : [];
      }),
    [persistedExecutions]
  );
  const executionTargetResolution = useMemo(
    () =>
      resolveConversationExecutionTargetHydration(
        sourceRootKey,
        executionTargetHydration,
        liveExecutionTargets
      ),
    [executionTargetHydration, liveExecutionTargets, sourceRootKey]
  );
  const executionTargetHydrationLoading = executionTargetResolution.loading;
  const executionTargetHydrationFailed = executionTargetResolution.failed;
  const executionTargets = executionTargetResolution.targets;
  const previousTargets = useMemo(() => {
    const targets = executionTargets.map((execution) => execution.target);
    if (source?.initialTarget) targets.push(source.initialTarget);
    return targets;
  }, [executionTargets, source]);
  const persistedTarget = executionTargets[0]?.target ?? null;
  useEffect(() => {
    if (!sourceRootKey) return;
    reconcilePickerOverride({
      rootKey: sourceRootKey,
      persistedTarget,
    });
  }, [persistedTarget, reconcilePickerOverride, sourceRootKey]);
  const preferredTarget =
    (sourceRootKey ? pickerOverrides.get(sourceRootKey) : undefined) ??
    persistedTarget;

  return {
    executionTargets,
    executionTargetHydrationLoading,
    executionTargetHydrationFailed,
    previousTargets,
    preferredTarget,
  };
}
