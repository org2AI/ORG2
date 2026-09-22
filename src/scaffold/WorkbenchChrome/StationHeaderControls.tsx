import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { usePinnedWorkbenchChromeVisible } from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import { stationChatVisibilityAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import type { StationMode } from "@src/types/ui/workstation";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  StationOpenInNewWindowButton,
  StationPaneControls,
  useStationPaneActions,
} from "./StationPaneControls";

/** Window/pane policy shared by both station headers; never reads tab state. */
export function StationHeaderControls({
  stationMode,
}: {
  stationMode: StationMode;
}) {
  const { t } = useTranslation("settings");
  const location = useLocation();
  const pinned = usePinnedWorkbenchChromeVisible();
  const visibility = useAtomValue(stationChatVisibilityAtom);
  const width = useAtomValue(chatWidthAtom);
  const position = useAtomValue(chatPanelPositionAtom);
  const { handleToggleChatPanel, handleToggleChatPanelMaximized } =
    useStationPaneActions();
  if (isStationWindow()) return null;
  // Settings replaces chat, so expose only the action to give Settings the pane.
  if (location.pathname.startsWith("/orgii/app/settings")) {
    return (
      <TabBarTrailingIconButton
        title={t("panel.maximizeSettings")}
        shortcutId="maximize_chat"
        onClick={handleToggleChatPanelMaximized}
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          data-icon="x"
          size={14}
          strokeWidth={2}
        />
      </TabBarTrailingIconButton>
    );
  }
  return (
    <>
      <StationOpenInNewWindowButton
        stationMode={stationMode}
        testId={`${stationMode}-open-in-new-window`}
      />
      {!pinned && (
        <StationPaneControls
          chatVisible={visibility[stationMode] && width > 0}
          chatPanelPosition={position}
          onToggleChat={handleToggleChatPanel}
          onMaximizeChat={handleToggleChatPanelMaximized}
        />
      )}
    </>
  );
}
