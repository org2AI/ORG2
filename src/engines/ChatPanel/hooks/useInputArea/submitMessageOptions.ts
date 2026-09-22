import type React from "react";

import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

import type {
  CiteCodeSnapshot,
  InputAreaRefs,
  SubmitOverrideInput,
} from "./types";

export interface UseSubmitMessageOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  /** Session whose comment threads Address Comments targets when the
   * composer dispatches elsewhere (external-history fork composer, where
   * `draftSessionId` is empty by design). */
  replyTargetEventId: string | undefined;
  flushDraft: (text: string) => Promise<void>;
  clearReplyTarget: () => Promise<void>;
  imageAttachment: {
    hasImages: boolean;
    images: ChatImageAttachment[];
    clearImages: () => void;
    restoreImages: (images: ChatImageAttachment[]) => void;
  };
  citeCode: {
    isCiteCode: boolean;
    clearCiteCode: () => void;
    captureCiteCode: () => CiteCodeSnapshot;
    restoreCiteCode: (snapshot: CiteCodeSnapshot) => void;
  };
  handleSessChatSubmit: (
    event: React.FormEvent | undefined,
    displayText: string,
    agentContent?: string,
    imageDataUrls?: string[]
  ) => Promise<void>;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
  submitDisabled?: boolean;
  enableAgentInterceptors?: boolean;
}
