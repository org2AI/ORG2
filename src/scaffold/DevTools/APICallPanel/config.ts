// ============================================
// Icon Configuration
// ============================================
import {
  AiNetworkIcon,
  Cancel01Icon,
  CursorPointer02Icon,
  Delete02Icon,
  FlashIcon,
  KeyboardIcon,
  Target01Icon,
  ViewIcon,
} from "@src/icons";

export const ICON_CONFIG = {
  // Action icons
  close: Cancel01Icon,
  delete: Delete02Icon,

  // Panel icons
  api: AiNetworkIcon,

  // Trigger icons
  triggerClick: CursorPointer02Icon,
  triggerHover: ViewIcon,
  triggerKeyboard: KeyboardIcon,
  triggerFocus: Target01Icon,
  triggerAuto: FlashIcon,
} as const;
