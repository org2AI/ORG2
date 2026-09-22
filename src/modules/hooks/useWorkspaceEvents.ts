/**
 * useWorkspaceEvents Hook
 *
 * Listens for the Tauri workspace-open event and handles navigation.
 */
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { isTauriDesktop } from "@src/util/platform/tauri";

interface OpenWorkspacePayload {
  sessionId: string;
  projectId: string;
  buildType?: string;
}

/** Navigate to the session referenced by an `open-workspace` event. */
export function useWorkspaceEvents(): void {
  const { openSession } = useSessionView();

  useTauriListen<OpenWorkspacePayload>(
    "open-workspace",
    ({ sessionId, projectId }) => {
      if (sessionId && projectId) {
        openSession(sessionId);
      }
    },
    { enabled: isTauriDesktop() }
  );
}
