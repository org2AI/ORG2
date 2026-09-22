import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { prepareChatImageFile } from "@src/engines/ChatPanel/hooks/useInputArea/imageExtensions";
import type { MobileSendAttachment } from "@src/modules/MobileRemote/connection/types";
import { MAX_CHAT_IMAGES } from "@src/store/ui/chatImageAtom";
import { optimizeImage } from "@src/util/optimization/imageOptimizer";

import { useMobileComposerDraft } from "./MobileComposerDraftContext";
import { MOBILE_DRAFT_IMAGE_BUDGET } from "./mobileComposerDraftStore";
import type {
  MobileComposerDraftHandle,
  MobileComposerImage,
} from "./mobileComposerDraftStore";

export function useMobileComposerImages(
  draftHandle?: MobileComposerDraftHandle
) {
  const { t } = useTranslation("mobileRemote");
  const { handle, snapshot } = useMobileComposerDraft(undefined, draftHandle);
  const { images, processing, imageError: error } = snapshot;

  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (handle.getSnapshot().processing) return;
      const entry = handle.capture();
      const setError = (imageError?: string) =>
        handle.updateIfCurrent(entry, (draft) => ({ ...draft, imageError }));
      const validFiles = files
        .map(prepareChatImageFile)
        .filter((file): file is File => file !== null);
      if (validFiles.length === 0) {
        if (files.length > 0) {
          setError(t("composer.attachments.unsupportedType"));
        }
        return;
      }

      const remaining = MAX_CHAT_IMAGES - handle.getSnapshot().images.length;
      if (remaining <= 0) {
        setError(
          t("composer.attachments.maxReached", { max: MAX_CHAT_IMAGES })
        );
        return;
      }

      const filesToProcess = validFiles.slice(0, remaining);
      if (validFiles.length > remaining) {
        setError(
          t("composer.attachments.remainingWarning", {
            remaining,
            max: MAX_CHAT_IMAGES,
          })
        );
      } else {
        setError(undefined);
      }

      handle.updateIfCurrent(entry, (draft) => ({
        ...draft,
        processing: true,
      }));
      const newImages: MobileComposerImage[] = [];

      try {
        for (const file of filesToProcess) {
          if (!handle.isCurrent(entry)) return;
          try {
            const result = await optimizeImage(file, {
              maxWidth: 1920,
              maxHeight: 1080,
              quality: 0.85,
              maxFileSizeBytes: 500 * 1024,
            });
            if (!handle.isCurrent(entry)) return;
            const retainedBytes = [
              ...handle.getSnapshot().images,
              ...newImages,
            ].reduce(
              (total, image) =>
                total + 2 * (image.dataUrl.length + image.fileName.length),
              0
            );
            if (
              retainedBytes + 2 * (result.dataUrl.length + file.name.length) >
              MOBILE_DRAFT_IMAGE_BUDGET
            ) {
              setError(t("composer.attachments.processFailed"));
              continue;
            }
            newImages.push({
              id: `mobile-img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              dataUrl: result.dataUrl,
              fileName: file.name || "photo.jpg",
            });
          } catch {
            setError(t("composer.attachments.processFailed"));
          }
        }

        if (newImages.length > 0) {
          try {
            handle.updateIfCurrent(entry, (draft) => ({
              ...draft,
              images: [...draft.images, ...newImages].slice(0, MAX_CHAT_IMAGES),
            }));
          } catch {
            setError(t("composer.attachments.processFailed"));
          }
        }
      } finally {
        handle.updateIfCurrent(entry, (draft) => ({
          ...draft,
          processing: false,
        }));
      }
    },
    [handle, t]
  );

  const removeImage = useCallback(
    (id: string) => {
      handle.update((draft) => ({
        ...draft,
        images: draft.images.filter((image) => image.id !== id),
        imageError: undefined,
      }));
    },
    [handle]
  );

  const toSendAttachments = useCallback((): MobileSendAttachment[] => {
    return handle
      .getSnapshot()
      .images.map(({ dataUrl, fileName }) => ({ dataUrl, fileName }));
  }, [handle]);

  return {
    images,
    hasImages: images.length > 0,
    processing,
    error,
    ingestFiles,
    removeImage,
    toSendAttachments,
  };
}
