import { useCallback, useState } from "react";

import type { ComposerSnapshot } from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { imageRefToRustPath } from "@src/util/file/imageRefs";

import type { useUserMessageDeliveryActions } from "../useUserMessageDeliveryActions";

interface UseUserChatItemEditArgs {
  messageImages: string[] | undefined;
  deliveryActions: ReturnType<typeof useUserMessageDeliveryActions>;
  onEditSubmit?: (newText: string, imageDataUrls?: string[]) => void;
}

/** Edit-mode state and submit/cancel handlers for a user turn. */
export function useUserChatItemEdit({
  messageImages,
  deliveryActions,
  onEditSubmit,
}: UseUserChatItemEditArgs) {
  const [isEditing, setIsEditing] = useState(false);
  // Editable copy of the message's attached images; seeded on edit entry so
  // the user can remove stale duplicates before resending.
  const [editImageList, setEditImageList] = useState<string[] | undefined>(
    undefined
  );

  const handleEditClick = useCallback(() => {
    setEditImageList(messageImages);
    setIsEditing(true);
  }, [messageImages]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleRemoveEditImage = useCallback((index: number) => {
    setEditImageList((prev) => prev?.filter((_, i) => i !== index));
  }, []);

  const handleEditSubmitInternal = useCallback(
    (
      newText: string,
      addedImageDataUrls?: string[],
      composerSnapshot?: ComposerSnapshot
    ) => {
      const retryEdit = deliveryActions.editAndRetry;
      if (retryEdit) {
        void retryEdit(newText, composerSnapshot)
          .then((accepted) => {
            if (accepted) setIsEditing(false);
          })
          .catch((error: unknown) => {
            Message.error(String(error));
          });
        return;
      }
      setIsEditing(false);
      const rustImages = [
        ...((editImageList && editImageList.length > 0
          ? editImageList.map(imageRefToRustPath)
          : []) as string[]),
        ...(addedImageDataUrls ?? []),
      ];
      onEditSubmit?.(newText, rustImages.length > 0 ? rustImages : undefined);
    },
    [deliveryActions, editImageList, onEditSubmit]
  );

  return {
    isEditing,
    editImageList,
    handleEditClick,
    handleEditCancel,
    handleRemoveEditImage,
    handleEditSubmitInternal,
  };
}
