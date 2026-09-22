import type { PillIconType } from "@src/components/ComposerInput/types";

import type { MarkdownEditorMode } from "./ModeSwitch";

export type InlineTrigger = {
  kind: "mention" | "slash";
  start: number;
  hasTriggerCharacter: boolean;
};

export interface MarkdownTextareaInsertOptions {
  separateFromAdjacentText?: boolean;
  clientX?: number;
  clientY?: number;
}

export interface MarkdownTextareaEditorRef {
  focus: () => void;
  getText: () => string;
  getMarkdown: () => string;
  setContent: (content: string) => void;
  clear: () => void;
  isEmpty: () => boolean;
  insertImage: (src: string, alt?: string) => void;
  insertText: (text: string, options?: MarkdownTextareaInsertOptions) => void;
  insertFilePill: (
    filePath: string,
    isFolder?: boolean,
    iconType?: PillIconType,
    displayName?: string
  ) => void;
  triggerAtMention: () => void;
  consumeMentionQuery: () => void;
}

export interface MarkdownTextareaEditorProps {
  value: string;
  onChange: (markdown: string, plainText: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  /**
   * Rows the autosize floor reserves. The floor is applied as an explicit
   * height, so it wins over `minHeight` whenever it is taller — a composer
   * that wants `minHeight` to govern passes a smaller value.
   */
  minRows?: number;
  maxHeight?: number | string;
  maxLength?: number;
  disabled?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
  appearance?: "plain" | "outlined";
  onSubmit?: () => void;
  onImageInsert?: (files: File[]) => void;
  onAtMention?: (
    query: string,
    cursorPosition: { x: number; y: number }
  ) => void;
  onAtMentionClose?: () => void;
  onSlashCommand?: (query: string) => void;
  onSlashCommandClose?: () => void;
  onKeyDownForDropdown?: (event: KeyboardEvent) => boolean;
  onKeyDownForSlashDropdown?: (event: KeyboardEvent) => boolean;
  dataTestId?: string;
  className?: string;
  mode?: MarkdownEditorMode;
  onModeChange?: (mode: MarkdownEditorMode) => void;
}
