export const CHAT_PANEL_TERMINAL_PREFIX = "chatpanel-";

export function isChatPanelTerminalId(id: string): boolean {
  return id.startsWith(CHAT_PANEL_TERMINAL_PREFIX);
}
