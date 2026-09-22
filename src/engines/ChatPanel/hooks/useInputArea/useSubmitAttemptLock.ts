import { useCallback, useRef } from "react";

import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

import type { InputAreaRefs, SubmitMessageOptions } from "./types";

interface UseSubmitAttemptLockOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  images: ChatImageAttachment[];
  submitMessage: (options?: SubmitMessageOptions) => Promise<void>;
}

export function useSubmitAttemptLock({
  refs,
  draftSessionId,
  images,
  submitMessage,
}: UseSubmitAttemptLockOptions): (
  options?: SubmitMessageOptions
) => Promise<void> {
  const submitAttemptsInFlightRef = useRef(new Set<string>());

  return useCallback(
    async (options?: SubmitMessageOptions) => {
      // Lock before asynchronous preprocessing (secret scan, MCP expansion,
      // pending-pill reads). A second Enter/click can otherwise start with the
      // same live editor text, arrive at the late payload-key guard only after
      // the first dispatch finishes, and send the same user intent twice.
      const liveDisplayText =
        refs.composerInputRef.current?.getTextWithPills() ?? "";
      const displayText =
        liveDisplayText.trim().length > 0
          ? liveDisplayText
          : (options?.capturedText ?? "");
      const submitAttemptKey = JSON.stringify({
        draftSessionId,
        displayText,
        imageDataUrls: images.map((image) => image.dataUrl),
      });
      const inFlightAttempts = submitAttemptsInFlightRef.current;
      if (inFlightAttempts.has(submitAttemptKey)) return;
      inFlightAttempts.add(submitAttemptKey);
      try {
        await submitMessage(options);
      } finally {
        inFlightAttempts.delete(submitAttemptKey);
      }
    },
    [draftSessionId, images, refs.composerInputRef, submitMessage]
  );
}
