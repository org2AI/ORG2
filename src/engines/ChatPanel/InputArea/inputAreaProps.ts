import type React from "react";

import type { SessionFollowUpSuggestion } from "@src/api/services/sessionFollowUpSuggestions";
import type {
  ComposerInputRef,
  ComposerSnapshot,
} from "@src/components/ComposerInput";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "@src/engines/ChatPanel/hooks/useInputArea/types";
import type { SlashItemCategory } from "@src/types/extensions";

import type { InputAreaPresentation } from "./inputAreaPresentation";

export interface InputAreaProps {
  placeholder?: string;
  isEditMode?: boolean;
  initialContent?: string;
  onEditSubmit?: (
    text: string,
    imageDataUrls?: string[],
    composerSnapshot?: ComposerSnapshot
  ) => void;
  onEditSendNow?: (text: string, imageDataUrls?: string[]) => void;
  onEditCancel?: () => void;
  editLabel?: string;
  editHeaderActions?: boolean;
  showEditHeader?: boolean;
  quietEditSurface?: boolean;
  editImages?: string[];
  onRemoveEditImage?: (index: number) => void;
  surfaceBg?: boolean;
  omitChatHeader?: boolean;
  sessionId?: string;
  /** Optional native execution episode for Stop/status; messages stay on sessionId. */
  controlSessionId?: string | null;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
  customMentionOptions?: ReadonlyArray<CustomMentionOption>;
  topRowPills?: React.ReactNode;
  topRowTrailingContent?: React.ReactNode;
  statusBanners?: React.ReactNode;
  /**
   * Tray tucked behind the top edge of the composer shell (queued messages).
   * Rendered directly above the shell so the shell overlaps its bottom edge.
   */
  composerTray?: React.ReactNode;
  followUpSuggestions?: ReadonlyArray<SessionFollowUpSuggestion>;
  onFollowUpSuggestionSent?: () => void;
  composerShellRef?: React.Ref<HTMLDivElement>;
  /**
   * Mirror of the live editor handle for surfaces that insert into this
   * composer from OUTSIDE its own rect — the channel panel drops a session
   * anywhere over its transcript and turns it into a pill here.
   */
  composerInputRef?: React.MutableRefObject<ComposerInputRef | null>;
  /**
   * False to refuse dragged tab/session reference pills on this composer.
   * Used by the cloud channel composer, which has no message plane to post
   * them to, so accepting a pill would be a lie.
   */
  acceptDraggedPills?: boolean;
  disableStopWhenEmpty?: boolean;
  submitDisabled?: boolean;
  sessionScope?: "active" | "none";
  /** Hide controls that only affect agent execution (model, mode, polish, voice). */
  showAgentControls?: boolean;
  /** Enable pasted, uploaded, and externally dropped file attachments. */
  allowFileAttachments?: boolean;
  /** Enable agent-only submit interceptors such as /compact and MCP tools. */
  enableAgentInterceptors?: boolean;
  /** Focus the shared composer editor when this InputArea mounts. */
  autoFocus?: boolean;
  /** Limit the slash menu to the supplied item categories. */
  slashItemCategories?: ReadonlyArray<SlashItemCategory>;
  /** Contextual composers used by element-selection surfaces. */
  presentation?: InputAreaPresentation;
}
