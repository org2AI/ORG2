import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import BottomSheet from "@src/components/BottomSheet";
import Button from "@src/components/Button";
import ComposerBarLayout from "@src/components/ComposerBar/ComposerBarLayout";
import ComposerSubmitButton from "@src/components/ComposerBar/ComposerSubmitButton";
import ComposerShell from "@src/components/ComposerShell";
import Textarea from "@src/components/Textarea";
import { VoiceInputButton, VoiceRecordingBar } from "@src/components/Voice";
import {
  COMPOSER_BOTTOM_DOCK_PADDING_CLASS,
  COMPOSER_HORIZONTAL_GUTTER_CLASS,
  MOBILE_COMPOSER_CONTENT_INSET_PX,
  MOBILE_COMPOSER_CONTENT_INSET_X_CLASS,
} from "@src/config/composerStackTokens";
import {
  INPUT_AREA_CONTROL_GROUP_CLASS,
  INPUT_AREA_EDITOR_HEIGHT,
} from "@src/config/inputAreaTokens";
import { type VoiceInputError, useVoiceInput } from "@src/hooks/voice";
import { resolveVoicePermissionErrorMessage } from "@src/hooks/voice/voicePermissionMessages";
import type { MobileSendAttachment } from "@src/modules/MobileRemote/connection/types";

import { MobileComposerAttachmentButton } from "./MobileComposerAttachmentButton";
import { useMobileComposerDraft } from "./MobileComposerDraftContext";
import { MobileComposerImagePreview } from "./MobileComposerImagePreview";
import { MobileModelPicker } from "./MobileModelPicker";
import type { MobileModelPickerProps } from "./MobileModelPicker";
import { MOBILE_DRAFT_TEXT_LIMIT } from "./mobileComposerDraftStore";
import "./mobileComposerResponsive.scss";
import { useMobileComposerImages } from "./useMobileComposerImages";

const MOBILE_COMPOSER_EDITOR_MIN_HEIGHT = 36;

export interface MobileComposerProps {
  /** Account/endpoint are owned by the provider; this identifies desktop + session. */
  draftScope?: string;
  disabled?: boolean;
  disabledReason?: string;
  statusMessage?: string;
  statusTone?: "neutral" | "error";
  onSend?: (
    content: string,
    attachments?: MobileSendAttachment[]
  ) => void | Promise<void>;
  modelPicker?: Omit<
    MobileModelPickerProps,
    "disabled" | "embedded" | "disabledReason"
  >;
}

export function MobileComposer({
  disabled = false,
  disabledReason,
  statusMessage,
  statusTone = "neutral",
  onSend,
  modelPicker,
  draftScope,
}: MobileComposerProps) {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const { t: tVoice } = useTranslation("sessions", { keyPrefix: "input" });
  const { handle: draftHandle, snapshot } = useMobileComposerDraft(draftScope);
  const { text: draft, submitting, submitError } = snapshot;
  const setDraft = useCallback(
    (value: string | ((text: string) => string)) => {
      draftHandle.update((current) => {
        const text = typeof value === "function" ? value(current.text) : value;
        return text.length <= MOBILE_DRAFT_TEXT_LIMIT
          ? { ...current, text }
          : {
              ...current,
              submitError: t("chat.draftTooLong", {
                max: MOBILE_DRAFT_TEXT_LIMIT,
              }),
            };
      });
    },
    [draftHandle, t]
  );
  const [voiceError, setVoiceError] = useState<string>();
  const [voicePermissionSheetOpen, setVoicePermissionSheetOpen] =
    useState(false);

  const handleVoiceCommit = useCallback(
    (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;
      setVoiceError(undefined);
      setDraft((existing) => {
        const separator =
          existing.length === 0 || /\s$/.test(existing) ? "" : " ";
        return `${existing}${separator}${trimmed}`;
      });
    },
    [setDraft]
  );

  const handleVoiceError = useCallback(
    (err: VoiceInputError) => {
      if (err.code === "permission-denied") {
        setVoiceError(resolveVoicePermissionErrorMessage(tVoice));
        setVoicePermissionSheetOpen(true);
      } else if (err.code === "unsupported") {
        setVoiceError(tVoice("voiceErrorUnsupported"));
      } else if (err.code === "audio-capture") {
        setVoiceError(tVoice("voiceErrorAudio"));
      } else if (err.code === "no-speech" || err.code === "aborted") {
        return;
      } else {
        setVoiceError(tVoice("voiceErrorGeneric"));
      }
    },
    [tVoice]
  );

  const voice = useVoiceInput({
    onCommit: handleVoiceCommit,
    onError: handleVoiceError,
  });

  const handleVoiceStart = useCallback(() => {
    setVoiceError(undefined);
    setVoicePermissionSheetOpen(false);
    voice.start();
  }, [voice]);

  const attachments = useMobileComposerImages(draftHandle);
  const { toSendAttachments } = attachments;

  const handleSend = useCallback(async () => {
    const submitted = draftHandle.getSnapshot();
    if (disabled || submitted.submitting || submitted.processing || !onSend)
      return;
    const trimmed = submitted.text.trim();
    const pendingAttachments = toSendAttachments();
    if (!trimmed && pendingAttachments.length === 0) return;
    const entry = draftHandle.capture();
    draftHandle.updateIfCurrent(entry, (current) => ({
      ...current,
      submitting: true,
      submitError: undefined,
    }));
    try {
      await onSend(trimmed, pendingAttachments);
      const sentImages = new Set(submitted.images.map((image) => image.id));
      draftHandle.updateIfCurrent(entry, (current) => ({
        ...current,
        text:
          current.textRevision === submitted.textRevision ? "" : current.text,
        images: current.images.filter((image) => !sentImages.has(image.id)),
      }));
    } catch (error) {
      draftHandle.updateIfCurrent(entry, (current) => ({
        ...current,
        submitError:
          error instanceof Error ? error.message : t("chat.sendFailed"),
      }));
    } finally {
      draftHandle.updateIfCurrent(entry, (current) => ({
        ...current,
        submitting: false,
      }));
    }
  }, [toSendAttachments, disabled, draftHandle, onSend, t]);

  const visibleStatus =
    attachments.error ??
    (voicePermissionSheetOpen ? undefined : voiceError) ??
    submitError ??
    statusMessage;
  const visibleStatusTone =
    attachments.error || voiceError || submitError ? "error" : statusTone;
  const trimmedDraft = draft.trim();
  const hasSendableContent = trimmedDraft.length > 0 || attachments.hasImages;
  const submitDisabled =
    disabled || submitting || voice.isRecording || attachments.processing;
  const sendLabel = submitting ? t("chat.sending") : t("chat.send");
  const footerMessage = disabled ? disabledReason : visibleStatus;
  const footerTone = disabled ? "neutral" : visibleStatusTone;
  const showVoiceUi = voice.isRecording;

  return (
    <div
      className={`relative shrink-0 pt-1 ${COMPOSER_HORIZONTAL_GUTTER_CLASS} ${COMPOSER_BOTTOM_DOCK_PADDING_CLASS} pb-[max(12px,env(safe-area-inset-bottom))]`}
      data-mobile-composer="true"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-24px] bottom-0 bg-gradient-to-t from-chat-container via-chat-container/95 to-transparent"
      />
      {footerMessage && !showVoiceUi ? (
        <div className="relative z-10 px-1 pb-1">
          <span
            className={`chat-block-xs block min-w-0 truncate ${
              footerTone === "error" ? "text-danger-6" : "text-text-3"
            }`}
            role={footerTone === "error" ? "alert" : "status"}
            title={footerMessage}
          >
            {footerMessage}
          </span>
        </div>
      ) : null}
      <ComposerShell
        variant="embedded"
        className="composer-breathing relative z-10"
      >
        {showVoiceUi ? (
          <VoiceRecordingBar
            className="mobile-composer-recording"
            elapsedClassName="mobile-type-caption"
            elapsedSeconds={voice.elapsedSeconds}
            onCancel={voice.cancel}
            onAccept={voice.stop}
          />
        ) : (
          <>
            {attachments.hasImages ? (
              <MobileComposerImagePreview
                images={attachments.images}
                onRemove={attachments.removeImage}
              />
            ) : null}
            <ComposerBarLayout
              toolbarClassName="mobile-composer-toolbar"
              toolbarPaddingClassName={MOBILE_COMPOSER_CONTENT_INSET_X_CLASS}
              editorSlot={
                <Textarea
                  value={draft}
                  maxLength={MOBILE_DRAFT_TEXT_LIMIT}
                  onChange={(value) => setDraft(value)}
                  placeholder={t("chat.typeMessage")}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  rows={1}
                  resize="none"
                  appearance="bare"
                  disabled={disabled}
                  preventMobileFocusZoom
                  className="min-w-0"
                  textareaClassName={`!${MOBILE_COMPOSER_CONTENT_INSET_X_CLASS} !py-1.5`}
                  textareaStyle={{
                    fontSize: "var(--mobile-type-body-size)",
                    lineHeight: "var(--mobile-type-body-leading)",
                    minHeight: MOBILE_COMPOSER_EDITOR_MIN_HEIGHT,
                    maxHeight: INPUT_AREA_EDITOR_HEIGHT.max,
                    paddingLeft: MOBILE_COMPOSER_CONTENT_INSET_PX,
                    paddingRight: MOBILE_COMPOSER_CONTENT_INSET_PX,
                  }}
                />
              }
              leftContent={
                <div className={INPUT_AREA_CONTROL_GROUP_CLASS}>
                  <MobileComposerAttachmentButton
                    disabled={disabled}
                    busy={attachments.processing}
                    onFilesSelected={attachments.ingestFiles}
                  />
                  {modelPicker ? (
                    <MobileModelPicker
                      {...modelPicker}
                      embedded
                      disabled={disabled}
                      patching={modelPicker.patching}
                    />
                  ) : null}
                </div>
              }
              rightContent={
                <div className="flex items-center gap-0.5">
                  <VoiceInputButton
                    className="mobile-composer-icon-action"
                    onPressStart={handleVoiceStart}
                    onPressEnd={voice.stop}
                    disabled={disabled || !voice.isSupported}
                  />
                  <ComposerSubmitButton
                    className="mobile-composer-icon-action mobile-composer-submit"
                    active={hasSendableContent && !submitDisabled}
                    disabled={submitDisabled}
                    busy={submitting}
                    ariaLabel={sendLabel}
                    onClick={() => void handleSend()}
                    state={submitting ? "submitting" : "submit"}
                    testId="mobile-composer-send"
                  />
                </div>
              }
            />
          </>
        )}
      </ComposerShell>
      <BottomSheet
        open={voicePermissionSheetOpen}
        onClose={() => setVoicePermissionSheetOpen(false)}
        title={tVoice("voicePermissionSheetTitle")}
        showCloseButton
        closeLabel={tCommon("actions.close")}
        footer={
          <Button
            variant="primary"
            className="min-h-11 w-full"
            style={{
              fontSize: "var(--mobile-type-control-size)",
              lineHeight: "var(--mobile-type-control-leading)",
            }}
            onClick={() => {
              setVoicePermissionSheetOpen(false);
              handleVoiceStart();
            }}
          >
            {tVoice("voicePermissionSheetRetry")}
          </Button>
        }
      >
        <p className="mobile-type-secondary text-text-2">{voiceError}</p>
      </BottomSheet>
    </div>
  );
}

MobileComposer.displayName = "MobileComposer";
