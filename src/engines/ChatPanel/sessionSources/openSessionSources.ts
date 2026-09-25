import { EditorTabService } from "@src/services/workStation/EditorTabService";
import { createSessionSourcesTab } from "@src/store/workstation/tabs/factories/sessionSources";
import { revealMyStation } from "@src/util/ui/revealMyStation";

/** Repeated activation focuses the same session-bound tab through the tab owner. */
export function openSessionSources(sessionId: string, title: string): void {
  if (!sessionId.trim()) return;
  EditorTabService.openTab(createSessionSourcesTab(sessionId, title));
  revealMyStation();
}
