import type { ComposerSnapshot } from "@src/components/ComposerInput";
import { createLogger } from "@src/hooks/logger";
import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

import type { UseSubmitMessageOptions } from "./submitMessageOptions";
import type { CiteCodeSnapshot, InputAreaRefs } from "./types";

const log = createLogger("useSubmitMessage");

interface DispatchSubmissionOptions {
  onSubmitOverride: UseSubmitMessageOptions["onSubmitOverride"];
  handleSessChatSubmit: UseSubmitMessageOptions["handleSessChatSubmit"];
  displayText: string;
  agentContent: string | undefined;
  imageDataUrls: string[];
  submitComposerSnapshot: ComposerSnapshot | undefined;
  memberMentions: Array<{ memberId: string; displayName: string }>;
  displayTextWithoutMemberMentions: string;
  agentContentWithoutMemberMentions: string | undefined;
}

export async function dispatchSubmission({
  onSubmitOverride,
  handleSessChatSubmit,
  displayText,
  agentContent,
  imageDataUrls,
  submitComposerSnapshot,
  memberMentions,
  displayTextWithoutMemberMentions,
  agentContentWithoutMemberMentions,
}: DispatchSubmissionOptions): Promise<void> {
  const dispatchImages = imageDataUrls.length > 0 ? imageDataUrls : undefined;
  const overrideHandled = onSubmitOverride
    ? await onSubmitOverride({
        displayText: displayText || "(image)",
        agentContent,
        imageDataUrls: dispatchImages,
        composerSnapshot: submitComposerSnapshot,
        memberMentions,
        displayTextWithoutMemberMentions,
        agentContentWithoutMemberMentions:
          agentContentWithoutMemberMentions ?? displayTextWithoutMemberMentions,
      })
    : false;
  if (!overrideHandled) {
    const ordinaryAgentContent =
      memberMentions.length > 0
        ? (agentContentWithoutMemberMentions ??
          displayTextWithoutMemberMentions)
        : agentContent;
    // Queue-vs-direct is decided inside handleSessChatSubmit against
    // the turn-lifecycle FSM — no composer-side heuristics.
    await handleSessChatSubmit(
      undefined,
      displayText || "(image)",
      ordinaryAgentContent,
      dispatchImages
    );
  }
}

interface RestoreSubmissionOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  flushDraft: UseSubmitMessageOptions["flushDraft"];
  imageAttachment: UseSubmitMessageOptions["imageAttachment"];
  citeCode: UseSubmitMessageOptions["citeCode"];
  editorSnapshot: ComposerSnapshot | null;
  imagesSnapshot: ChatImageAttachment[];
  citeSnapshot: CiteCodeSnapshot | null;
}

/**
 * Put the pre-send editor, image, and cite-code snapshots back after a
 * dispatch error that has not retained a visible failed row.
 */
export function restoreSubmissionAfterDispatchError({
  refs,
  draftSessionId,
  flushDraft,
  imageAttachment,
  citeCode,
  editorSnapshot,
  imagesSnapshot,
  citeSnapshot,
}: RestoreSubmissionOptions): void {
  const editor = refs.composerInputRef.current;
  if (editor && editorSnapshot) {
    try {
      editor.setContent(editorSnapshot);
      refs.setHasContent(true);
      if (draftSessionId) {
        void flushDraft(editor.getTextWithPills()).catch(
          (restoreError: unknown) => {
            log.warn(
              "[useSubmitMessage] flushDraft(validation restore) failed:",
              restoreError
            );
          }
        );
      }
    } catch (restoreError) {
      log.warn("[useSubmitMessage] editor restore failed:", restoreError);
    }
  }
  if (imagesSnapshot.length > 0) {
    try {
      imageAttachment.restoreImages(imagesSnapshot);
    } catch (restoreError) {
      log.warn("[useSubmitMessage] image restore failed:", restoreError);
    }
  }
  if (citeSnapshot) {
    try {
      citeCode.restoreCiteCode(citeSnapshot);
    } catch (restoreError) {
      log.warn("[useSubmitMessage] cite restore failed:", restoreError);
    }
  }
}
