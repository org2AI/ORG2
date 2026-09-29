import { EditorTabService } from "@src/services/workStation/EditorTabService";
import { openChatPanelSourcesAtom } from "@src/store/chatPanel/chatPanelCompanionAtom";
import { createSessionSourcesTab } from "@src/store/workstation/tabs/factories/sessionSources";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { revealMyStation } from "@src/util/ui/revealMyStation";

/** Sources open beside the conversation unless the user explicitly chooses Station. */
export function openSessionSources(
  sessionId: string,
  title: string,
  destination: "chat-panel" | "my-station" = "chat-panel"
): void {
  if (!sessionId.trim()) return;
  if (destination === "chat-panel") {
    getInstrumentedStore().set(openChatPanelSourcesAtom, sessionId);
    return;
  }
  EditorTabService.openTab(createSessionSourcesTab(sessionId, title));
  revealMyStation();
}
