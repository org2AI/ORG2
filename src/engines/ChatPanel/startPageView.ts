import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanel/selectionAtoms";

export type StartPageView = "session" | "work-item" | "more";

/** The start-page tab a create target belongs to. */
export function resolveStartPageView(
  createTarget: ChatPanelCreateTarget
): StartPageView {
  return createTarget === CHAT_PANEL_CREATE_TARGET.AGENT_SESSION
    ? "session"
    : createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM
      ? "work-item"
      : "more";
}
