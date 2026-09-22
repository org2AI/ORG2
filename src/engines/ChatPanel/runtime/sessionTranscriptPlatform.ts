import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import {
  loadErrorAtom,
  loadStatusAtom,
  sessionHydrationByIdAtom,
} from "@src/engines/SessionCore";
import { useAgentWorkingRef } from "@src/hooks/streaming/useAgentWorkingRef";
import { sessionByIdAtom } from "@src/store/session";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  sessionRolledBackAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { cursorIdeTurnSummariesAtomFamily } from "@src/store/session/cursorIdeTurnSummariesAtom";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import { useReloadSession } from "../ChatHistory/hooks/useReloadSession";
import { useSessionTranscriptRuntime } from "../SessionTranscriptRuntimeContext";
import type { SessionTranscriptPlatformState } from "./sessionTranscriptPlatform.types";

/** Desktop adapter for the shared transcript. Webpack replaces this module in
 * the browser entry with the Cloud/context-backed implementation. */
export function useSessionTranscriptPlatform(
  sessionId: string | null
): SessionTranscriptPlatformState {
  const runtime = useSessionTranscriptRuntime();
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const rawCursorIdeTurnSummaries = useAtomValue(
    cursorIdeTurnSummariesAtomFamily(sessionId ?? "")
  );
  const desktopIsAgentWorking = useAtomValue(isSessionActiveAtom);
  const desktopIsAgentWorkingRef = useAgentWorkingRef();
  const desktopLoadStatus = useAtomValue(loadStatusAtom);
  const desktopLoadError = useAtomValue(loadErrorAtom);
  const isPendingCancel = useAtomValue(isPendingCancelAtom);
  const isRolledBack = useAtomValue(sessionRolledBackAtom);
  const hydration = useAtomValue(sessionHydrationByIdAtom(sessionId ?? ""));

  const desktopReload = useReloadSession(sessionId);

  const runtimeAgentWorkingRef = useRef(runtime?.isAgentWorking ?? false);
  useEffect(() => {
    runtimeAgentWorkingRef.current = runtime?.isAgentWorking ?? false;
  }, [runtime?.isAgentWorking]);

  const isCursorIde = sessionId ? isCursorIdeSession(sessionId) : false;

  return {
    session,
    cursorIdeTurnSummaries: isCursorIde ? rawCursorIdeTurnSummaries : [],
    isCursorIde,
    isAgentWorking: runtime?.isAgentWorking ?? desktopIsAgentWorking,
    isAgentWorkingRef: runtime
      ? runtimeAgentWorkingRef
      : desktopIsAgentWorkingRef,
    loadStatus: runtime?.loadStatus ?? desktopLoadStatus,
    loadError: runtime?.loadError ?? desktopLoadError,
    isPendingCancel: runtime ? false : isPendingCancel,
    isRolledBack: runtime ? false : isRolledBack,
    isHydrating: runtime ? false : (hydration?.count ?? 0) > 0,
    onReload: runtime?.onReload ?? desktopReload,
    capabilities: {
      canvasInline: runtime?.capabilities?.canvasInline !== false,
      turnMetadata: runtime?.capabilities?.turnMetadata !== false,
    },
  };
}
