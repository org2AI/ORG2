import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MenuSegmentedRow } from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import {
  SIDE_POSITION_OPTIONS,
  SPOTLIGHT_PLACEMENT_OPTIONS,
  localizeMenuOptions,
} from "@src/config/appearance/quickMenuOptions";
import {
  CHAT_SPLIT_RATIO_LABELS,
  CHAT_SPLIT_RATIO_VALUES,
  type ChatSplitRatio,
} from "@src/engines/ChatPanel/config";
import {
  type ModelPickerStyle,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanel/displayPrefsAtoms";
import { chatSplitRatioAtom } from "@src/store/ui/chatPanel/splitRatioAtoms";
import { activeStationChatVisibleAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  type SpotlightPlacement,
  spotlightPlacementAtom,
} from "@src/store/ui/uiAtom";
import { chatPanelPositionAtom } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import {
  workStationLayoutModeAtom,
  workStationLayoutModePersistAtom,
} from "@src/store/ui/workStationLayout/splitLayoutAtoms";

interface SidebarLayoutSettingsSubmenuProps {
  panelRef: React.Ref<HTMLDivElement>;
  position: {
    left: number;
    top: number;
  };
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}

type ChatPanelPosition = "left" | "right";
type WorkstationSidebarPosition = "left" | "right";

const chatSplitRatioOptions = CHAT_SPLIT_RATIO_VALUES.map((value) => ({
  value,
  label: CHAT_SPLIT_RATIO_LABELS[value],
}));

export const SidebarLayoutSettingsSubmenu: React.FC<SidebarLayoutSettingsSubmenuProps> =
  React.memo(({ panelRef, position, onPointerDown, onMouseDown }) => {
    const { t } = useTranslation("common");
    const { t: tSettings } = useTranslation("settings");
    const [spotlightPlacement, setSpotlightPlacement] = useAtom(
      spotlightPlacementAtom
    );
    const stationMode = useAtomValue(stationModeAtom);
    const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
    const layoutMode = useAtomValue(workStationLayoutModeAtom);
    const setLayoutModePersist = useSetAtom(workStationLayoutModePersistAtom);
    const [chatPanelPosition, setChatPanelPosition] = useAtom(
      chatPanelPositionAtom
    );
    const [chatSplitRatio, setChatSplitRatio] = useAtom(chatSplitRatioAtom);
    const [modelPickerStyle, setModelPickerStyle] =
      useAtom(modelPickerStyleAtom);
    const chatPositionOptions = localizeMenuOptions(SIDE_POSITION_OPTIONS, t);
    const spotlightPlacementOptions = localizeMenuOptions(
      SPOTLIGHT_PLACEMENT_OPTIONS,
      tSettings
    );
    const modelPickerStyleOptions = [
      { value: "spotlight", label: t("layoutSettings.modelPickerSpotlight") },
      { value: "dropdown", label: t("layoutSettings.modelPickerMenu") },
    ] as const;

    const handleChatPanelPositionChange = useCallback(
      (value: ChatPanelPosition) => {
        setStationChatVisible(stationMode, true);
        setChatPanelPosition(value);
      },
      [setChatPanelPosition, setStationChatVisible, stationMode]
    );

    return (
      <div
        ref={panelRef}
        className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.panelWidthClass} fixed`}
        style={{ left: position.left, top: position.top }}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
      >
        <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
          <MenuSegmentedRow<ChatPanelPosition>
            label={t("layoutSettings.chatPanelLocation")}
            value={chatPanelPosition}
            options={chatPositionOptions}
            onChange={handleChatPanelPositionChange}
          />
          <MenuSegmentedRow<ChatSplitRatio>
            label={t("layoutSettings.chatSplitRatio")}
            value={chatSplitRatio}
            options={chatSplitRatioOptions}
            onChange={setChatSplitRatio}
          />
          <MenuSegmentedRow<WorkstationSidebarPosition>
            label={t("layoutSettings.sidebarPosition")}
            value={layoutMode}
            options={chatPositionOptions}
            onChange={setLayoutModePersist}
          />
          <MenuSegmentedRow<ModelPickerStyle>
            label={t("layoutSettings.modelPickerStyle")}
            value={modelPickerStyle}
            options={modelPickerStyleOptions}
            onChange={setModelPickerStyle}
          />
          <MenuSegmentedRow<SpotlightPlacement>
            label={tSettings("general.spotlightPlacement")}
            value={spotlightPlacement}
            options={spotlightPlacementOptions}
            onChange={setSpotlightPlacement}
          />
        </div>
      </div>
    );
  });

SidebarLayoutSettingsSubmenu.displayName = "SidebarLayoutSettingsSubmenu";
