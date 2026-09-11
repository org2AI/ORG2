import { useAtomValue, useStore } from "jotai";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Modal from "@src/scaffold/ModalSystem";

import { getCloudEndpoint } from "./config";
import { downloadSharedSessionFile } from "./downloadSharedSessionFile";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { useCloudFreshAccessToken } from "./org2CloudSessionCommentsAtom.freshToken";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";
import {
  type SharedSessionFile,
  findSharedSessionFile,
  readSharedSessionFile,
} from "./sharedSessionFilesClient";

type Loaded = SharedSessionFile & {
  bytes: Uint8Array;
  identity: string;
  requestKey: string;
};
export default function SharedSessionFileViewer({
  reference,
  onClose,
}: {
  reference: SharedSessionFileReference;
  onClose: () => void;
}) {
  const { t } = useTranslation("sessions");
  const auth = useAtomValue(org2CloudAuthAtom);
  const store = useStore();
  const identity = auth ? org2CloudAuthIdentityKey(auth) : "";
  const token = useCloudFreshAccessToken();
  const requestKey = JSON.stringify(reference);
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const reference = JSON.parse(requestKey) as SharedSessionFileReference;
    const controller = new AbortController();
    const endpoint = getCloudEndpoint();
    setFile(null);
    setError(false);
    if (!identity || endpoint.supabaseUrl !== reference.endpoint) {
      setError(true);
      return;
    }
    const stillCurrent = () => {
      const latest = store.get(org2CloudAuthAtom);
      return (
        !controller.signal.aborted &&
        latest &&
        org2CloudAuthIdentityKey(latest) === identity &&
        getCloudEndpoint().supabaseUrl === endpoint.supabaseUrl
      );
    };
    void (async () => {
      const accessToken = await token();
      if (!stillCurrent()) return;
      const located = reference.source
        ? await findSharedSessionFile(
            accessToken,
            endpoint,
            reference.source.orgId,
            reference.source.sessionId,
            reference.source.path,
            undefined,
            controller.signal
          )
        : null;
      if (reference.source && !located)
        throw new Error("File has not been uploaded by its source device");
      if (!stillCurrent()) return;
      const result = await readSharedSessionFile(
        accessToken,
        endpoint,
        located?.id ?? reference.id,
        controller.signal
      );
      if (stillCurrent()) setFile({ ...result, identity, requestKey });
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [identity, requestKey, token, store]);
  const currentFile =
    file?.identity === identity && file.requestKey === requestKey ? file : null;
  const [media, setMedia] = useState<{
    fileId: string;
    url: string;
    pdf: boolean;
  } | null>(null);
  useEffect(() => {
    if (!currentFile) {
      setMedia(null);
      return;
    }
    const extension = currentFile.name.split(".").pop()?.toLowerCase();
    const mime =
      extension === "pdf"
        ? "application/pdf"
        : extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "webp"
              ? "image/webp"
              : extension === "gif"
                ? "image/gif"
                : null;
    if (!mime) {
      setMedia(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(currentFile.bytes)], { type: mime })
    );
    setMedia({ fileId: currentFile.id, url, pdf: extension === "pdf" });
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);
  const activeMedia = media?.fileId === currentFile?.id ? media : null;
  const preview = React.useMemo(() => {
    if (!currentFile || currentFile.bytes.length > 128 * 1024) return null;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        currentFile.bytes
      );
      return text.includes("\0") ? null : text;
    } catch {
      return null;
    }
  }, [currentFile]);
  const download = async () => {
    if (!currentFile || saving) return;
    setSaving(true);
    try {
      const name = await downloadSharedSessionFile(currentFile, () => {
        const latest = store.get(org2CloudAuthAtom);
        return Boolean(
          latest &&
          org2CloudAuthIdentityKey(latest) === currentFile.identity &&
          getCloudEndpoint().supabaseUrl === reference.endpoint
        );
      });
      if (name)
        Message.success(t("sharedFile.downloaded", "Saved to Downloads"));
    } catch {
      Message.error(
        t("sharedFile.downloadError", "Unable to save to Downloads")
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      visible
      title={currentFile?.name ?? t("sharedFile.title", "Shared file")}
      onCancel={onClose}
      footer={null}
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p role="alert">
            {t(
              "sharedFile.error",
              "Unable to open this file. Check your account, server, and session access, then reopen the link."
            )}
          </p>
        ) : currentFile ? (
          <>
            {activeMedia ? (
              activeMedia.pdf ? (
                <iframe
                  title={currentFile.name}
                  src={activeMedia.url}
                  sandbox=""
                  className="h-96 w-full"
                />
              ) : (
                <img
                  src={activeMedia.url}
                  alt={currentFile.name}
                  className="max-h-96 max-w-full object-contain"
                />
              )
            ) : preview !== null ? (
              <pre className="max-h-96 overflow-auto rounded-md bg-fill-1 p-3 text-sm break-words whitespace-pre-wrap text-text-1">
                {preview}
              </pre>
            ) : (
              <p>
                {t(
                  "sharedFile.downloadPreview",
                  "Download this file to view its contents"
                )}
              </p>
            )}
            <Button
              data-testid="shared-file-download"
              loading={saving}
              onClick={() => void download()}
            >
              {t("sharedFile.download", "Download")}
            </Button>
          </>
        ) : (
          <p role="status">{t("sharedFile.loading", "Loading shared file…")}</p>
        )}
      </div>
    </Modal>
  );
}
