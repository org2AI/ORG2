import type { WorkStationTabType } from "@src/store/workstation/tabs";

export function shouldShowWorkStationStatusBar({
  isAgentStation,
  activeTabType,
}: {
  isAgentStation: boolean;
  activeTabType?: WorkStationTabType;
}): boolean {
  return !isAgentStation && activeTabType !== "chat-session";
}
