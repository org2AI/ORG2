/**
 * useSubmitMessage
 *
 * Extracts the message-submission logic from useInputArea so the parent hook
 * stays under the 600-line limit while keeping the full submit flow isolated
 * and independently testable.
 *
 * Responsibilities:
 *   - MCP slash-command resolution before dispatch
 *   - Question auto-respond / reject intercept
 *   - Context pill terminal-text collection
 *   - Optimistic editor clear + atomic snapshot/restore on failure
 *   - Image draft clear/restore
 *   - Draft text flush on success / restore on failure
 *   - Reply-target clear after successful send
 */
import { useAtomValue, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  chatQuotedSelectionsAtom,
  clearChatQuotedSelectionAtom,
  setChatQuotedSelectionAtom,
} from "@src/engines/ChatPanel/chatSelections/chatSelectionAtoms";
import { createLogger } from "@src/hooks/logger";
import { useSecretScanGuard } from "@src/hooks/security/useSecretScanGuard";
import { useSessionCommandActions } from "@src/hooks/session/useSessionPatch";
import { sessionByIdAtom } from "@src/store/session";
import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";
import { wpReadOnlyAtom } from "@src/store/ui/chatPanel/miscAtoms";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { clearImageDraft } from "../../InputArea/utils/imageDraftCache";
import {
  manualCompactInFlightSessionAtom,
  parseCompactSlashCommand,
  useManualCompact,
} from "../useManualCompact";
import { expandSkillPills } from "./outgoingTextTransforms";
import {
  dispatchSubmission,
  restoreSubmissionAfterDispatchError,
} from "./submissionDispatch";
import { shouldRestoreSubmissionAfterDispatchError } from "./submissionErrors";
import {
  applySubmissionInterceptors,
  interceptNativeSlashCommand,
} from "./submissionInterceptors";
import {
  buildSubmissionContextBlocks,
  buildSubmissionPayload,
} from "./submissionProjection";
import {
  resolveSubmitInput,
  serializeSubmissionSnapshot,
} from "./submissionSnapshot";
import type { UseSubmitMessageOptions } from "./submitMessageOptions";
import type { CiteCodeSnapshot, SubmitMessageOptions } from "./types";
import { SubmitRetainedDeliveryError } from "./types";
import { useSubmitAttemptLock } from "./useSubmitAttemptLock";

// Re-exported for existing consumers/tests; the implementation moved to the
// shared outgoing-text transform module so every projection entry point uses
// the same copy.
export { stripContextPillBase64 } from "./outgoingTextTransforms";
export {
  memberMentionsFromSnapshot,
  resolveSubmitInput,
  serializeSubmissionSnapshot,
} from "./submissionSnapshot";
export type { UseSubmitMessageOptions } from "./submitMessageOptions";

const log = createLogger("useSubmitMessage");

// ============================================================================
// Hook
// ============================================================================

export function useSubmitMessage({
  refs,
  draftSessionId,
  replyTargetEventId,
  flushDraft,
  clearReplyTarget,
  imageAttachment,
  citeCode,
  handleSessChatSubmit,
  onSubmitOverride,
  submitDisabled = false,
  enableAgentInterceptors = true,
}: UseSubmitMessageOptions): (options?: SubmitMessageOptions) => Promise<void> {
  const { t } = useTranslation("sessions");
  const store = useStore();
  const wpReadOnly = useAtomValue(wpReadOnlyAtom);
  const submitInFlightKeyRef = useRef<string | null>(null);
  const { runManualCompact } = useManualCompact();
  const { setPlan, rename } = useSessionCommandActions(draftSessionId);
  const guardAgainstSecrets = useSecretScanGuard();
  const submitMessage = useCallback(
    async (options: SubmitMessageOptions = {}) => {
      // Imported teammate replays are intentionally read-only in the event
      // store, but their composer owns an onSubmitOverride that admits the
      // turn to the canonical conversation queue. Let that coordinator inspect
      // the submission before applying the ordinary read-only guard; otherwise
      // the generic "No active session" toast makes continuation unreachable.
      if (wpReadOnly && !onSubmitOverride) {
        Message.warning(t("chat.noActiveSession"));
        return;
      }

      if (!refs.composerInputRef.current) return;
      // ── Compaction gate ──────────────────────────────────────────────────
      // While this session's durable transcript is being rewritten by a
      // manual compaction, hold new messages instead of dispatching them.
      // (The backend scheduler serializes them anyway; this keeps the UX
      // honest — the user sees why nothing is happening.)
      if (
        draftSessionId &&
        store.get(manualCompactInFlightSessionAtom) === draftSessionId
      ) {
        Message.info(t("common:contextInfo.manualCompactInProgress"));
        return;
      }

      const isExplicitAction = options.source === "explicit-action";
      const editorTextAtSubmit =
        refs.composerInputRef.current.getTextWithPills();
      const submitComposerSnapshot = isExplicitAction
        ? undefined
        : refs.composerInputRef.current.getSnapshot();
      const liveDisplayText = submitComposerSnapshot
        ? serializeSubmissionSnapshot(submitComposerSnapshot, false)
        : editorTextAtSubmit;
      const resolvedInput = resolveSubmitInput(
        options,
        liveDisplayText,
        imageAttachment.hasImages
      );
      // Capture typed mention identities before any async secret scan, MCP
      // expansion, or pending-pill load. Display text is not an identity
      // source: a roster rename while those awaits run must not retarget the
      // Team Chat message.
      let { displayText } = resolvedInput;
      const hasText = displayText.trim().length > 0;
      const { hasAttachedImages } = resolvedInput;

      if (!hasText && !hasAttachedImages) {
        return;
      }

      const provider = store.get(sessionByIdAtom(draftSessionId))?.cliAgentType;
      if (enableAgentInterceptors && !hasAttachedImages) {
        const nativeIntercept = await interceptNativeSlashCommand({
          store,
          draftSessionId,
          provider,
          displayText,
          submitDisabled,
          isExplicitAction,
          composerInputRef: refs.composerInputRef,
          flushDraft,
          guardAgainstSecrets,
          setPlan,
          rename,
          onSubmitted: options.onSubmitted,
        });
        if (nativeIntercept.handled) return;
        displayText = nativeIntercept.displayText;
      }

      // ── /compact slash command ───────────────────────────────────────────
      // `/compact [instructions]` runs a manual context compaction instead
      // of dispatching a message (Claude Code parity). Only a pure text
      // command qualifies — attached images mean the user is sending real
      // content that happens to start with "/compact".
      if (
        enableAgentInterceptors &&
        hasText &&
        !hasAttachedImages &&
        !(
          isCliSession(draftSessionId) &&
          (provider === "codex" || provider === "claude_code")
        )
      ) {
        const compactCommand = parseCompactSlashCommand(displayText);
        if (compactCommand) {
          if (!isExplicitAction) {
            refs.composerInputRef.current.clear();
            void flushDraft("").catch((err: unknown) => {
              log.warn("[useSubmitMessage] flushDraft(compact) failed:", err);
            });
          }
          void runManualCompact(
            draftSessionId || null,
            compactCommand.instructions
          );
          options.onSubmitted?.();
          return;
        }
      }

      // A running session blocks ordinary sends, but not `/compact`: manual
      // compaction is a maintenance job queued behind the active turn by the
      // backend scheduler. Parse the command first so selecting its pill never
      // becomes a silent no-op while the session is working.
      if (submitDisabled) {
        return;
      }

      const gateResult = await applySubmissionInterceptors({
        store,
        draftSessionId,
        displayText,
        hasText,
        enableAgentInterceptors,
        guardAgainstSecrets,
        skippedByUserLabel: () => t("chat.skippedByUser"),
      });
      if (gateResult.handled) return;
      displayText = gateResult.displayText;

      // ── Skill pill expansion ──────────────────────────────────────────────
      // displayText keeps `name [skill:/<name>]` for rendering pills in
      // history. The shared transform extracts the `/<name>` path token the
      // Rust backend expects; the result feeds the session-pill scan below
      // (the final agent projection re-runs the same transform internally).
      const { expanded: skillExpanded, hasSkillPills } =
        expandSkillPills(displayText);

      // ── Context pill async loads ──────────────────────────────────────────
      if (!isExplicitAction) {
        const { waitForPendingPills } =
          await import("@src/util/contextPillContent");
        await waitForPendingPills();
      }

      const terminalTexts = isExplicitAction
        ? {}
        : refs.composerInputRef.current.getTerminalPillTexts();
      const contextBlocks = buildSubmissionContextBlocks({
        scanText: hasSkillPills ? skillExpanded : displayText,
        terminalTexts,
        resolveSessionName: (referencedSessionId) =>
          store.get(sessionByIdAtom(referencedSessionId))?.name,
      });

      // A quoted reply is part of the message, not a side channel: the
      // blockquote goes into the same display copy history renders and the
      // agent reads. `isExplicitAction` submissions (auto-respond, rejects)
      // are not the user's draft and carry no quote.
      const quotedSelection = isExplicitAction
        ? undefined
        : store.get(chatQuotedSelectionsAtom)[draftSessionId];

      const payload = buildSubmissionPayload({
        displayText,
        quotedSelection,
        contextBlocks,
        enableAgentInterceptors,
        hasAttachedImages,
        draftSessionId,
        submitComposerSnapshot,
        images: imageAttachment.images,
        isExplicitAction,
      });
      displayText = payload.displayText;
      const {
        agentContent,
        displayTextWithoutMemberMentions,
        agentContentWithoutMemberMentions,
        memberMentions,
        imageDataUrls,
        submitKey,
      } = payload;
      if (submitInFlightKeyRef.current === submitKey) return;
      submitInFlightKeyRef.current = submitKey;

      let submitSucceeded = false;
      try {
        // ── Snapshot before optimistic clear ─────────────────────────────────
        // Captured only so a true pre-send validation failure can leave the
        // composer untouched. Transport/provider failures remain visible on
        // the failed transcript row and never repopulate this editor.
        const editorSnapshot = submitComposerSnapshot ?? null;
        const imagesSnapshot: ChatImageAttachment[] = isExplicitAction
          ? []
          : imageAttachment.images.slice();
        const citeSnapshot: CiteCodeSnapshot | null = citeCode.isCiteCode
          ? isExplicitAction
            ? null
            : citeCode.captureCiteCode()
          : null;

        // ── Optimistic clear ──────────────────────────────────────────────────
        const editorTextBeforeClear =
          refs.composerInputRef.current.getTextWithPills();
        const editorStillContainsSubmittedText =
          !isExplicitAction &&
          // Compare the editor with itself before preprocessing. Snapshot
          // serialization and MCP expansion can change the outgoing text
          // without the user having edited the draft.
          editorTextBeforeClear === editorTextAtSubmit;
        if (editorStillContainsSubmittedText) {
          refs.composerInputRef.current.clear();
          refs.setHasContent(false);
          if (citeCode.isCiteCode) {
            citeCode.clearCiteCode();
          }
          if (quotedSelection) {
            store.set(clearChatQuotedSelectionAtom, draftSessionId);
          }
          imageAttachment.clearImages();
          clearImageDraft(draftSessionId);
        }

        if (draftSessionId && editorStillContainsSubmittedText) {
          void flushDraft("").catch((err: unknown) => {
            log.warn("[useSubmitMessage] flushDraft(clear) failed:", err);
          });
        }

        // ── Dispatch ──────────────────────────────────────────────────────────
        try {
          await dispatchSubmission({
            onSubmitOverride,
            handleSessChatSubmit,
            displayText,
            agentContent,
            imageDataUrls,
            submitComposerSnapshot,
            memberMentions,
            displayTextWithoutMemberMentions,
            agentContentWithoutMemberMentions,
          });
          submitSucceeded = true;
        } catch (err) {
          // Until a transport has retained a visible failed row, the composer
          // remains the only recoverable copy of the user's text, images and
          // structured mention pills. Optimistic transports explicitly mark
          // that ownership hand-off with SubmitRetainedDeliveryError. A Group
          // delivery with an unknown outcome similarly owns an immutable retry
          // envelope and must not also repopulate the editor.
          if (
            !(err instanceof SubmitRetainedDeliveryError) &&
            shouldRestoreSubmissionAfterDispatchError(err)
          ) {
            restoreSubmissionAfterDispatchError({
              refs,
              draftSessionId,
              flushDraft,
              imageAttachment,
              citeCode,
              editorSnapshot,
              imagesSnapshot,
              citeSnapshot,
            });
            // The composer is the only copy again, so the quote it was
            // replying to has to come back with it.
            if (quotedSelection) {
              store.set(setChatQuotedSelectionAtom, {
                sessionId: draftSessionId,
                text: quotedSelection,
              });
            }
          }

          const reason = err instanceof Error ? err.message : String(err);
          const baseMsg = t("chat.failedToSendMessage");
          Message.error(reason ? `${baseMsg}: ${reason}` : baseMsg);
        }
      } finally {
        submitInFlightKeyRef.current = null;
      }

      if (!submitSucceeded) return;

      // ── Post-send cleanup ─────────────────────────────────────────────────
      if (!isExplicitAction && draftSessionId && replyTargetEventId) {
        void clearReplyTarget().catch((err: unknown) => {
          log.warn(
            "[useSubmitMessage] clearReplyTarget(post-send) failed:",
            err
          );
        });
      }
      options.onSubmitted?.();
    },
    [
      wpReadOnly,
      store,
      guardAgainstSecrets,
      handleSessChatSubmit,
      citeCode,
      refs,
      imageAttachment,
      t,
      draftSessionId,
      flushDraft,
      replyTargetEventId,
      clearReplyTarget,
      onSubmitOverride,
      submitDisabled,
      enableAgentInterceptors,
      runManualCompact,
      setPlan,
      rename,
    ]
  );

  return useSubmitAttemptLock({
    refs,
    draftSessionId,
    images: imageAttachment.images,
    submitMessage,
  });
}
