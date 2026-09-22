/**
 * TextSelectionDropdown Configuration
 *
 * Configuration for the text selection dropdown that appears
 * when text is selected in terminal, browser, or editor views.
 */
import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  FileScriptIcon,
  type IconSvgElement,
  MailReply01Icon,
  MessageCircleQuestionMarkIcon,
  PinIcon,
  TextQuoteIcon,
  Tick01Icon,
  WorkHistoryIcon,
} from "@src/icons";

// ============================================
// Types
// ============================================

export type DropdownAction =
  | "ask-agent"
  | "add-to-chat"
  | "add-to-context"
  | "add-file"
  | "add-lines"
  | "pin"
  | "reply-to-selection";

export interface DropdownMenuItem {
  id: DropdownAction;
  label: string;
  icon: IconSvgElement;
  hasSecondLayer?: boolean;
}

export interface SessionItem {
  sessionId: string;
  name: string;
  isNew?: boolean;
}

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  askAgent: MessageCircleQuestionMarkIcon,
  addContext: Add01Icon,
  addFile: FileScriptIcon,
  addLines: TextQuoteIcon,
  pin: PinIcon,
  replyToSelection: MailReply01Icon,
  session: WorkHistoryIcon,
  newSession: Add01Icon,
  arrow: ArrowRight02Icon,
  arrowBack: ArrowLeft02Icon,
  check: Tick01Icon,
} as const;

// ============================================
// Menu Configuration
// ============================================

// Menu items for terminal/browser — single action, no session picker
export const MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-to-chat",
    label: "Add to Chat",
    icon: ICON_CONFIG.addContext,
    hasSecondLayer: false,
  },
];

// Menu items for a chat transcript selection — a mark in the conversation
// navigator, or a quoted reply in the composer. Neither sends anything.
export const CHAT_MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "pin",
    label: "Pin",
    icon: ICON_CONFIG.pin,
    hasSecondLayer: false,
  },
  {
    id: "reply-to-selection",
    label: "Reply to selection",
    icon: ICON_CONFIG.replyToSelection,
    hasSecondLayer: false,
  },
];

// Menu items for editor
export const EDITOR_MENU_ITEMS: DropdownMenuItem[] = [
  {
    id: "add-file",
    label: "Add this file to agent",
    icon: ICON_CONFIG.addFile,
    hasSecondLayer: false,
  },
  {
    id: "add-lines",
    label: "Add line {from} ~ {to} to agent",
    icon: ICON_CONFIG.addLines,
    hasSecondLayer: false,
  },
];

// ============================================
// Style Configuration
// ============================================

/**
 * Presentation of the menu.
 * - `menu`: the stacked dropdown rows every context menu uses.
 * - `inline`: one horizontal pill of text actions, floated over the
 *   selection — for surfaces where a full menu would bury short text in
 *   chrome, like a passage selected in the chat transcript.
 */
export type TextSelectionLayout = "menu" | "inline";

export const STYLE_CONFIG = {
  dropdownWidth: "180px",
  secondLayerWidth: "240px",
  maxHeight: "240px",
  itemHeight: "36px",
  zIndex: 99999,
  /** Gap between the inline bar and the selection it floats above. */
  inlineOffsetY: 8,
} as const;

export const INLINE_CLASSES = {
  bar: "flex items-center gap-0.5 p-0.5",
  action:
    "cursor-pointer rounded-[6px] px-2 py-1 text-[13px] whitespace-nowrap text-text-1 transition-colors",
  divider: "mx-0.5 h-3.5 w-px shrink-0 bg-border-2",
} as const;

// ============================================
// Keyboard Shortcuts
// ============================================

export const KEYBOARD_CONFIG = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  enter: "Enter",
  escape: "Escape",
} as const;
