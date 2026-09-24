import { useSetAtom, useStore } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { getAgentOrgRejectedRequestDraft } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import PanelFooter from "@src/components/layout/blocks/PanelFooter";
import Modal from "@src/scaffold/ModalSystem";
import { sessionByIdAtom } from "@src/store/session";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";

import { readImageDraft } from "../../InputArea/utils/imageDraftCache";

interface RecoveryPreview {
  displayContent: string;
  imageDataUrls: string[];
  existingDraft: string;
}

function PreviewText({ children }: { children: string }) {
  return (
    <div className="max-h-28 overflow-auto rounded-md bg-bg-2 p-2 text-[11px] leading-4 whitespace-pre-wrap text-text-2">
      {children}
    </div>
  );
}

export function RejectedRequestRecoveryAction({
  sessionId,
  turnIntentId,
}: {
  sessionId: string;
  turnIntentId: string;
}) {
  const { t } = useTranslation("sessions");
  const store = useStore();
  const setRestoreToInput = useSetAtom(restoreToInputAtom);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);

  const restore = useCallback(
    (draft: Pick<RecoveryPreview, "displayContent" | "imageDataUrls">) => {
      setRestoreToInput({
        sessionId,
        displayContent: draft.displayContent,
        imageDataUrls: draft.imageDataUrls,
        appendImages: true,
      });
      setPreview(null);
    },
    [sessionId, setRestoreToInput]
  );

  const handleLoad = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const recovered = await getAgentOrgRejectedRequestDraft({
        sessionId,
        turnIntentId,
      });
      const existingDraft =
        store.get(sessionByIdAtom(sessionId))?.draftText?.trim() ?? "";
      const hasExistingImages = readImageDraft(sessionId).length > 0;
      if (!existingDraft && !hasExistingImages) {
        restore(recovered);
        return;
      }
      setPreview({
        displayContent: recovered.displayContent,
        imageDataUrls: recovered.imageDataUrls,
        existingDraft,
      });
    } catch {
      Message.error(t("orgTask.rejectedRequestRecovery.unavailable"));
    } finally {
      setLoading(false);
    }
  }, [loading, restore, sessionId, store, t, turnIntentId]);

  return (
    <>
      <div className="mt-2 flex flex-col items-start gap-1.5">
        <Button
          variant="secondary"
          size="mini"
          loading={loading}
          onClick={() => void handleLoad()}
          data-testid="agent-org-rejected-request-restore-button"
        >
          {t("orgTask.rejectedRequestRecovery.restore")}
        </Button>
        <span className="text-[11px] leading-4 text-text-3">
          {t("orgTask.rejectedRequestRecovery.warning")}
        </span>
      </div>
      <Modal
        visible={preview !== null}
        title={t("orgTask.rejectedRequestRecovery.previewTitle")}
        width={480}
        maskClosable={!loading}
        closable={!loading}
        onCancel={() => setPreview(null)}
        bodyClassName="space-y-3 p-3"
        footer={
          <PanelFooter
            secondaryActions={[
              {
                label: t("common:actions.cancel"),
                onClick: () => setPreview(null),
              },
            ]}
            primaryAction={{
              label: t("orgTask.rejectedRequestRecovery.append"),
              onClick: () => {
                if (preview) restore(preview);
              },
              dataTestId: "agent-org-rejected-request-append-button",
            }}
          />
        }
      >
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-text-1">
            {t("orgTask.rejectedRequestRecovery.existingDraft")}
          </div>
          <PreviewText>{preview?.existingDraft ?? ""}</PreviewText>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-text-1">
            {t("orgTask.rejectedRequestRecovery.recoveredRequest")}
          </div>
          <PreviewText>{preview?.displayContent ?? ""}</PreviewText>
        </div>
        <div className="text-[11px] leading-4 text-text-2">
          {t("orgTask.rejectedRequestRecovery.appendExplanation")}
        </div>
      </Modal>
    </>
  );
}
