import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type ConversationRootLocator,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import type { LocalExecutionSegment } from "@src/engines/SessionCore/conversations/localConversationExecutionTail";
import { transcriptReplaceEpochAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import { createLogger } from "@src/hooks/logger";
import type { ActiveMessageDelivery } from "@src/store/ui/messageQueueAtom";

import {
  type LocalExecutionHydrationCoordinator,
  type LocalExecutionHydrationRequest,
  type LocalExecutionHydrationSnapshot,
  type LocalExecutionHydrationTrigger,
  createLocalExecutionHydrationCoordinator,
  hydrateLocalExecutionSnapshot,
  projectVisibleLocalExecutionTail,
  shouldHydrateLocalExecutionSnapshot,
} from "./localExecutionHydration";

const EMPTY_LOCAL_EXECUTION_SEGMENTS: readonly LocalExecutionSegment[] = [];
const log = createLogger("ConversationStreamProvider");

interface UseLocalExecutionTailsArgs {
  sessionId: string;
  localRoot: ConversationRootLocator | null;
  localRootKey: string | null;
  activeDeliveries: readonly ActiveMessageDelivery[];
}

/**
 * Hydrates this device's native execution children for the local root and
 * projects their verified, chat-visible tail. Rehydration follows
 * `shouldHydrateLocalExecutionSnapshot`, never a delivery start.
 */
export function useLocalExecutionTails({
  sessionId,
  localRoot,
  localRootKey,
  activeDeliveries,
}: UseLocalExecutionTailsArgs) {
  const localRootRef = useRef(localRoot);
  useEffect(() => {
    localRootRef.current = localRoot;
  }, [localRoot]);
  const localRootDeliveryCount = useMemo(
    () =>
      localRootKey
        ? activeDeliveries.filter(
            (delivery) =>
              conversationRootKey(delivery.conversationDispatch.root) ===
              localRootKey
          ).length
        : 0,
    [activeDeliveries, localRootKey]
  );
  const nativeRefreshEpoch = useAtomValue(transcriptReplaceEpochAtom);
  const [loadedLocalExecution, setLoadedLocalExecution] =
    useState<LocalExecutionHydrationSnapshot | null>(null);
  const localHydrationCoordinatorRef =
    useRef<LocalExecutionHydrationCoordinator<LocalExecutionHydrationRequest> | null>(
      null
    );
  const localHydrationTriggerRef =
    useRef<LocalExecutionHydrationTrigger | null>(null);
  useEffect(() => {
    const coordinator = createLocalExecutionHydrationCoordinator<
      LocalExecutionHydrationRequest,
      LocalExecutionHydrationSnapshot
    >(
      hydrateLocalExecutionSnapshot,
      (next) => {
        setLoadedLocalExecution(next);
      },
      (error, request) => {
        log.warn("local execution hydration could not load children", {
          sessionId: request.root.conversationId,
          localRootKey: request.rootKey,
          error,
        });
      }
    );
    localHydrationCoordinatorRef.current = coordinator;
    coordinator.activate();
    return () => {
      coordinator.deactivate();
      if (localHydrationCoordinatorRef.current === coordinator) {
        localHydrationCoordinatorRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    const nextTrigger = {
      rootKey: localRootKey,
      activeDeliveryCount: localRootDeliveryCount,
      refreshEpoch: nativeRefreshEpoch,
    };
    const shouldHydrate = shouldHydrateLocalExecutionSnapshot(
      localHydrationTriggerRef.current,
      nextTrigger
    );
    localHydrationTriggerRef.current = nextTrigger;
    const coordinator = localHydrationCoordinatorRef.current;
    if (!coordinator) return;
    const currentRoot = localRootRef.current;
    if (!currentRoot || !localRootKey) {
      coordinator.invalidate();
      return;
    }
    if (!shouldHydrate) return;
    coordinator.request({
      root: currentRoot,
      rootKey: localRootKey,
    });
  }, [localRootDeliveryCount, localRootKey, nativeRefreshEpoch]);
  const localSnapshot =
    localRootKey && loadedLocalExecution?.rootKey === localRootKey
      ? loadedLocalExecution.snapshot
      : null;
  const authoritativeLocalRootEvents = localSnapshot?.rootEvents ?? null;
  const localExecutionSegments: readonly LocalExecutionSegment[] =
    localSnapshot?.segments ?? EMPTY_LOCAL_EXECUTION_SEGMENTS;
  const localTails = useMemo(() => {
    if (!localRootKey || !authoritativeLocalRootEvents) return [];
    return projectVisibleLocalExecutionTail(
      authoritativeLocalRootEvents,
      localExecutionSegments,
      sessionId
    );
  }, [
    authoritativeLocalRootEvents,
    localExecutionSegments,
    localRootKey,
    sessionId,
  ]);

  return localTails;
}
