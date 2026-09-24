import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

export function mergeRestoredImageAttachments(params: {
  existing: ChatImageAttachment[];
  restored: ChatImageAttachment[];
  ownerId: string;
  append: boolean;
}): ChatImageAttachment[] {
  const retained = params.append
    ? params.existing
    : params.existing.filter((image) => image.ownerId !== params.ownerId);
  return [...retained, ...params.restored];
}
