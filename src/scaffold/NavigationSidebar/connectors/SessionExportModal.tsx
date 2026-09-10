import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import Modal from "@src/scaffold/ModalSystem";
import type { Session } from "@src/store/session";

import {
  SESSION_JSON_FILTER,
  type SessionExportDraft,
  type SessionExportPreview,
  buildSessionExportDraft,
  formatCategoryLabel,
  formatEventCount,
  stringifySessionExportFile,
} from "./sessionImportExport";

const logger = createLogger("SessionExportModal");

interface SessionExportModalProps {
  visible: boolean;
  activeSession?: Session;
  sessionFallbackName: string;
  onClose: () => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-bg-2 px-3 py-2">
      <span className="shrink-0 text-xs whitespace-nowrap text-text-3">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-sm text-text-1">
        {value}
      </span>
    </div>
  );
}

export function SessionExportModal({
  visible,
  activeSession,
  sessionFallbackName,
  onClose,
}: SessionExportModalProps) {
  const { t } = useTranslation("sessions");
  const [exportDraft, setExportDraft] = useState<SessionExportDraft | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const exportPreview: SessionExportPreview | null =
    exportDraft?.preview ?? null;

  React.useEffect(() => {
    if (!visible) {
      setExportDraft(null);
      setLoading(false);
      return;
    }
    if (!activeSession) return;

    let cancelled = false;
    setLoading(true);
    buildSessionExportDraft(activeSession, sessionFallbackName)
      .then((draft) => {
        if (!cancelled) setExportDraft(draft);
      })
      .catch((error: unknown) => {
        logger.error("failed to build export preview:", error);
        if (!cancelled)
          Message.error(t("chat.importExport.errors.previewFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession, sessionFallbackName, t, visible]);

  const handleConfirmExport = useCallback(async () => {
    if (!exportDraft) return;
    try {
      const filePath = await saveDialog({
        defaultPath: exportDraft.preview.fileName,
        filters: [SESSION_JSON_FILTER],
      });
      if (!filePath) return;
      setLoading(true);
      await writeTextFile(
        filePath,
        stringifySessionExportFile(exportDraft.file)
      );
      Message.success(t("chat.importExport.exportSuccess"));
      onClose();
    } catch (error) {
      logger.error("failed to export session:", error);
      Message.error(t("chat.importExport.errors.exportFailed"));
    } finally {
      setLoading(false);
    }
  }, [exportDraft, onClose, t]);

  return (
    <Modal
      visible={visible}
      title={t("chat.importExport.exportTitle")}
      onCancel={onClose}
      onOk={handleConfirmExport}
      okText={t("chat.importExport.exportAction")}
      cancelText={t("common:actions.cancel")}
      okButtonProps={{ loading, disabled: !activeSession || !exportPreview }}
      closable={!loading}
      cancelButtonProps={{ disabled: loading }}
      width={640}
      maskClosable={!loading}
      escToExit={!loading}
    >
      <div className="flex flex-col gap-4 p-1">
        {exportPreview && (
          <div className="flex flex-col gap-2">
            <InfoRow
              label={t("chat.importExport.fields.session")}
              value={exportPreview.displayName}
            />
            <InfoRow
              label={t("chat.importExport.fields.type")}
              value={formatCategoryLabel(exportPreview.category, t)}
            />
            <InfoRow
              label={t("chat.importExport.fields.events")}
              value={formatEventCount(exportPreview.eventCount, t)}
            />
            <InfoRow
              label={t("chat.importExport.fields.file")}
              value={exportPreview.fileName}
            />
          </div>
        )}

        {!exportPreview && (
          <div className="rounded-lg bg-bg-2 px-3 py-4 text-center text-sm text-text-3">
            {loading
              ? t("chat.importExport.loadingPreview")
              : t("chat.importExport.noActiveSession")}
          </div>
        )}
      </div>
    </Modal>
  );
}
