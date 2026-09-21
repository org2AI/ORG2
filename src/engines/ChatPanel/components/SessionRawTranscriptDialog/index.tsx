import React, { Suspense, lazy, memo } from "react";
import { useTranslation } from "react-i18next";

import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import { ClipboardIcon, HugeiconsIcon, Refresh04Icon } from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";

import { useSessionRawTranscript } from "./useSessionRawTranscript";

// Lazy (same as SessionRawTranscriptView): the transcript content pulls
// CodeMirror, and this dialog is imported by the WorkStation TabBar — which
// every workstation surface renders — but only opens on demand.
const SessionRawTranscriptContent = lazy(
  () => import("./SessionRawTranscriptContent")
);

interface SessionRawTranscriptDialogProps {
  sessionId: string | null;
  visible: boolean;
  onClose: () => void;
}

const SessionRawTranscriptDialog: React.FC<SessionRawTranscriptDialogProps> =
  memo(({ sessionId, visible, onClose }) => {
    const { t } = useTranslation("sessions");
    const transcript = useSessionRawTranscript(sessionId, visible);

    return (
      <Modal
        visible={visible}
        title={t("chat.rawTranscript.title", {
          defaultValue: "Raw session transcript",
        })}
        onClose={onClose}
        width="min(960px, 92vw)"
        bodyClassName="flex min-h-0 flex-col p-0"
        style={{ height: "min(760px, 84vh)" }}
        footer={
          <PanelFooter
            secondaryActions={[
              {
                label: t("common:actions.refresh", "Refresh"),
                icon: (
                  <HugeiconsIcon
                    icon={Refresh04Icon}
                    data-icon="refresh-cw"
                    size={14}
                    strokeWidth={1.75}
                  />
                ),
                loading: transcript.loading,
                disabled: !sessionId,
                onClick: () => void transcript.loadTranscript(),
              },
              {
                label: t("common:actions.copy", "Copy"),
                icon: (
                  <HugeiconsIcon
                    icon={ClipboardIcon}
                    data-icon="clipboard"
                    size={14}
                    strokeWidth={1.75}
                  />
                ),
                disabled: !transcript.snapshot || transcript.loading,
                onClick: () => void transcript.copyTranscript(),
              },
            ]}
            primaryAction={{
              label: t("common:actions.close", "Close"),
              onClick: onClose,
            }}
          />
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
          <Suspense fallback={null}>
            <SessionRawTranscriptContent
              error={transcript.error}
              filePath={
                sessionId ? `raw-transcript-${sessionId}.json` : undefined
              }
              loaded={Boolean(transcript.snapshot)}
              loading={transcript.loading}
              transcriptJson={transcript.transcriptJson}
            />
          </Suspense>
        </div>
      </Modal>
    );
  });

SessionRawTranscriptDialog.displayName = "SessionRawTranscriptDialog";

export default SessionRawTranscriptDialog;
