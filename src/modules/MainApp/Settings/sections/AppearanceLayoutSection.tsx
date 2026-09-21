import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { SectionContainer, SectionRow } from "@src/components/layout/Section";
import {
  ChatPanelPositionFigure,
  ModelPickerStyleFigure,
  SidebarPositionFigure,
} from "@src/modules/MainApp/Settings/previews/layoutPreviews";
import {
  LabelWithPreview,
  PreviewGrid,
  previewItems,
  withOptionPreviews,
} from "@src/modules/MainApp/Settings/previews/primitives";
import {
  type ModelPickerStyle,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanel/displayPrefsAtoms";
import {
  type ChatPanelPosition,
  chatPanelPositionAtom,
} from "@src/store/ui/workStationLayout/chatPositionAtoms";
import {
  type LayoutMode,
  workStationLayoutModePersistAtom,
} from "@src/store/ui/workStationLayout/splitLayoutAtoms";

const renderChatPanelPosition = (position: ChatPanelPosition) => (
  <ChatPanelPositionFigure position={position} />
);
const renderSidebarPosition = (position: LayoutMode) => (
  <SidebarPositionFigure position={position} />
);
const renderModelPickerStyle = (style: ModelPickerStyle) => (
  <ModelPickerStyleFigure style={style} />
);

/**
 * App-level layout preferences. Each row binds the same atom as the sidebar
 * Layout quick menu, so a change on either surface shows on the other.
 */
export const AppearanceLayoutSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [chatPanelPosition, setChatPanelPosition] = useAtom(
    chatPanelPositionAtom
  );
  const [workstationSidebarPosition, setWorkstationSidebarPosition] = useAtom(
    workStationLayoutModePersistAtom
  );
  const [modelPickerStyle, setModelPickerStyle] = useAtom(modelPickerStyleAtom);
  const sideOptions = [
    { value: "left", label: t("common:layoutSettings.left") },
    { value: "right", label: t("common:layoutSettings.right") },
  ] as const;
  const modelPickerStyleOptions = [
    {
      value: "spotlight",
      label: t("common:layoutSettings.modelPickerSpotlight"),
    },
    {
      value: "dropdown",
      label: t("common:layoutSettings.modelPickerMenu"),
    },
  ] as const;

  return (
    <SectionContainer title={t("general.layout")}>
      <SectionRow
        settingsSearchKeys="general.chatPanelPosition"
        label={
          <LabelWithPreview
            label={t("common:layoutSettings.chatPanelLocation")}
            preview={
              <PreviewGrid
                items={previewItems(sideOptions, renderChatPanelPosition)}
              />
            }
          />
        }
      >
        <SegmentedTextPill<ChatPanelPosition>
          ariaLabel={t("common:layoutSettings.chatPanelLocation")}
          value={chatPanelPosition}
          onChange={setChatPanelPosition}
          options={withOptionPreviews(sideOptions, renderChatPanelPosition)}
          size="large"
          dataTestId="chat-panel-position-select"
        />
      </SectionRow>
      <SectionRow
        label={
          <LabelWithPreview
            label={t("common:layoutSettings.sidebarPosition")}
            preview={
              <PreviewGrid
                items={previewItems(sideOptions, renderSidebarPosition)}
              />
            }
          />
        }
      >
        <SegmentedTextPill<LayoutMode>
          ariaLabel={t("common:layoutSettings.sidebarPosition")}
          value={workstationSidebarPosition}
          onChange={setWorkstationSidebarPosition}
          options={withOptionPreviews(sideOptions, renderSidebarPosition)}
          size="large"
          dataTestId="workstation-sidebar-position-select"
        />
      </SectionRow>
      <SectionRow
        settingsSearchKeys="general.modelPickerStyle"
        label={
          <LabelWithPreview
            label={t("settings:general.modelPickerStyle")}
            preview={
              <PreviewGrid
                items={previewItems(
                  modelPickerStyleOptions,
                  renderModelPickerStyle
                )}
              />
            }
          />
        }
      >
        <SegmentedTextPill<ModelPickerStyle>
          ariaLabel={t("settings:general.modelPickerStyle")}
          value={modelPickerStyle}
          onChange={setModelPickerStyle}
          options={withOptionPreviews(
            modelPickerStyleOptions,
            renderModelPickerStyle
          )}
          size="large"
          dataTestId="model-picker-style-select"
        />
      </SectionRow>
    </SectionContainer>
  );
};
