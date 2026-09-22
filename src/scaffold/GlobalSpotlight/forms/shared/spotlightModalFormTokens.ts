import { INPUT_AREA } from "@src/config/inputAreaTokens";

export const SPOTLIGHT_MODAL_FORM_TOKENS = {
  bodyClassName: "px-3 pb-3",
  shellClassName: `overflow-hidden [--modal-chrome-padding:--spacing(3)] ${INPUT_AREA.backgroundChatPanelClass}`,
} as const;
