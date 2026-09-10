import type React from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Message";
import { type VoiceInputError, useVoiceInput } from "@src/hooks/voice";
import { useVoiceShortcut } from "@src/hooks/voice/useVoiceShortcut";

interface UseInputAreaVoiceOptions {
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  isEditMode: boolean;
}

export function useInputAreaVoice({
  composerInputRef,
  containerRef,
  enabled,
  isEditMode,
}: UseInputAreaVoiceOptions) {
  const { t } = useTranslation("sessions");

  const handleVoiceCommit = useCallback(
    (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;
      const editor = composerInputRef.current;
      if (!editor) return;
      const existing = editor.getText();
      const separator =
        existing.length === 0 || /\s$/.test(existing) ? "" : " ";
      editor.setContent(`${existing}${separator}${trimmed}`);
      editor.focus();
    },
    [composerInputRef]
  );

  const handleVoiceError = useCallback(
    (err: VoiceInputError) => {
      if (err.code === "permission-denied") {
        Message.error(t("input.voiceErrorPermission"));
      } else if (err.code === "unsupported") {
        Message.error(t("input.voiceErrorUnsupported"));
      } else if (err.code === "audio-capture") {
        Message.error(t("input.voiceErrorAudio"));
      } else if (err.code === "no-speech") {
        return;
      } else if (err.code !== "aborted") {
        Message.error(t("input.voiceErrorGeneric"));
      }
    },
    [t]
  );

  const voice = useVoiceInput({
    onCommit: handleVoiceCommit,
    onError: handleVoiceError,
  });

  useVoiceShortcut(containerRef, enabled && !isEditMode, voice);

  return {
    voice,
    showVoiceUi: enabled && voice.isRecording && !isEditMode,
  };
}
