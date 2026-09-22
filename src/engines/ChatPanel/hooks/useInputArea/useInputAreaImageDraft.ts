import { useEffect, useRef } from "react";

import {
  readImageDraft,
  writeImageDraft,
} from "../../InputArea/utils/imageDraftCache";
import type { useImageAttachment } from "./useImageAttachment";

interface UseInputAreaImageDraftOptions {
  draftSessionId: string;
  restoreImages: ReturnType<typeof useImageAttachment>["restoreImages"];
  attachmentImages: ReturnType<typeof useImageAttachment>["images"];
}

export function useInputAreaImageDraft({
  draftSessionId,
  restoreImages,
  attachmentImages,
}: UseInputAreaImageDraftOptions): void {
  const imageDraftSessionRef = useRef<string | null>(null);
  const imageDraftHydratingRef = useRef(false);

  useEffect(() => {
    if (!draftSessionId) {
      imageDraftSessionRef.current = null;
      imageDraftHydratingRef.current = true;
      restoreImages([]);
      queueMicrotask(() => {
        imageDraftHydratingRef.current = false;
      });
      return;
    }

    if (imageDraftSessionRef.current === draftSessionId) return;
    imageDraftSessionRef.current = draftSessionId;
    imageDraftHydratingRef.current = true;
    restoreImages(readImageDraft(draftSessionId));
    queueMicrotask(() => {
      imageDraftHydratingRef.current = false;
    });
  }, [draftSessionId, restoreImages]);

  useEffect(() => {
    if (!draftSessionId || imageDraftHydratingRef.current) return;
    writeImageDraft(draftSessionId, attachmentImages);
  }, [draftSessionId, attachmentImages]);
}
