/**
 * SessionCreatorChatPanel — creator pickers.
 *
 * The three pickers the creator opens outside its content column: the hidden
 * file-upload input, the dispatch-category picker anchored on the agent hero,
 * and Wingman's screen picker.
 */
import type React from "react";

import { DispatchCategoryPicker } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette/DispatchCategoryPicker";

import ScreenPickerModal from "./ScreenPickerModal";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";

type ChatPanelCreatorPickersProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "categoryPickerProps"
  | "fileInputRef"
  | "hideSessionSetupControls"
  | "isCategorySelectorOpen"
  | "onFileUpload"
  | "screenPickerProps"
>;

/** File-upload input, dispatch-category picker and screen picker. */
export const ChatPanelCreatorPickers: React.FC<
  ChatPanelCreatorPickersProps
> = ({
  categoryPickerProps,
  fileInputRef,
  hideSessionSetupControls,
  isCategorySelectorOpen,
  onFileUpload,
  screenPickerProps,
}) => (
  <>
    {!hideSessionSetupControls && (
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-file-upload-input"
        onChange={onFileUpload}
        accept="*/*"
      />
    )}

    <DispatchCategoryPicker
      style={categoryPickerProps.modelPickerStyle}
      includeHumanSession={categoryPickerProps.includeHumanSession}
      isOpen={isCategorySelectorOpen}
      onClose={categoryPickerProps.onClose}
      onSelect={categoryPickerProps.onSelect}
      currentCategory={categoryPickerProps.currentCategory}
      currentAgentDefinitionId={categoryPickerProps.currentAgentDefinitionId}
      currentAgentOrgId={categoryPickerProps.currentAgentOrgId}
      currentCliAgentType={categoryPickerProps.currentCliAgentType}
      anchorRef={categoryPickerProps.anchorRef}
    />

    {screenPickerProps && <ScreenPickerModal {...screenPickerProps} />}
  </>
);
