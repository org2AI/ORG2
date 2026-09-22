import { useEffect, useRef } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { useImageAttachmentTarget } from "@src/components/ImageActions/context";
import { isChatImageFile } from "@src/engines/ChatPanel/hooks/useInputArea/imageExtensions";

/** Register only the writable, non-edit composer in this chat surface. */
export function useImageMenuTarget({
  sessionId,
  enabled,
  add,
  input,
}: {
  sessionId?: string;
  enabled: boolean;
  add: (files: File[], signal?: AbortSignal) => Promise<number>;
  input: React.RefObject<ComposerInputRef | null>;
}) {
  const registryRef = useImageAttachmentTarget();
  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  }, [add]);
  useEffect(() => {
    if (!registryRef || !enabled || !sessionId) return;
    const controller = new AbortController();
    let focusFrame: number | undefined;
    const target = {
      signal: controller.signal,
      add: async (file: File, signal: AbortSignal) => {
        if (signal.aborted || controller.signal.aborted) return 0;
        if (!isChatImageFile(file))
          throw new Error("Unsupported attachment image format");
        const preparation = new AbortController();
        const abort = () => preparation.abort();
        signal.addEventListener("abort", abort, { once: true });
        controller.signal.addEventListener("abort", abort, { once: true });
        try {
          return await addRef.current([file], preparation.signal);
        } finally {
          signal.removeEventListener("abort", abort);
          controller.signal.removeEventListener("abort", abort);
        }
      },
      // Owned by the composer, so closing the image modal cannot cancel focus.
      // Wait for its focus trap to unmount before focusing the draft.
      focus: () => {
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(() => {
          focusFrame = undefined;
          if (!controller.signal.aborted) input.current?.focus();
        });
      },
    };
    registryRef.current = target;
    return () => {
      controller.abort();
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      if (registryRef.current === target) registryRef.current = null;
    };
  }, [registryRef, sessionId, enabled, input]);
}
