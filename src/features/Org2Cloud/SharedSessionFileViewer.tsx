import { useAtomValue, useStore } from "jotai";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";

import { getCloudEndpoint } from "./config";
import { downloadSharedSessionFile } from "./downloadSharedSessionFile";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { useCloudFreshAccessToken } from "./org2CloudSessionCommentsAtom.freshToken";
import { useSharedSessionFileAccess } from "./sharedSessionFileAccess";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";
import {
  type SharedSessionFile,
  findSharedSessionFile,
  findSharedSessionFileVersion,
  readSharedSessionFile,
} from "./sharedSessionFilesClient";

type Loaded = SharedSessionFile & {
  bytes: Uint8Array;
  identity: string;
  requestKey: string;
  shareToken?: string;
};
export default function SharedSessionFileViewer({
  reference,
  openingIdentity,
}: {
  reference: SharedSessionFileReference;
  openingIdentity: string;
}) {
  const { t } = useTranslation("sessions");
  const auth = useAtomValue(org2CloudAuthAtom);
  const store = useStore();
  const identity = auth ? org2CloudAuthIdentityKey(auth) : "";
  const token = useCloudFreshAccessToken();
  const access = useSharedSessionFileAccess();
  const shareToken =
    access?.endpoint === reference.endpoint ? access.shareToken : undefined;
  const shareTokenRef = useRef(shareToken);
  shareTokenRef.current = shareToken;
  const requestKey = JSON.stringify(reference);
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<"not_uploaded" | "request_failed" | null>(
    null
  );
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const reference = JSON.parse(requestKey) as SharedSessionFileReference;
    const controller = new AbortController();
    const endpoint = getCloudEndpoint();
    setFile(null);
    setError(null);
    if (
      !identity ||
      identity !== openingIdentity ||
      endpoint.supabaseUrl !== reference.endpoint
    ) {
      setError("request_failed");
      return;
    }
    const stillCurrent = () => {
      const latest = store.get(org2CloudAuthAtom);
      return (
        !controller.signal.aborted &&
        shareTokenRef.current === shareToken &&
        latest &&
        org2CloudAuthIdentityKey(latest) === identity &&
        getCloudEndpoint().supabaseUrl === endpoint.supabaseUrl
      );
    };
    void (async () => {
      const accessToken = await token();
      if (!stillCurrent()) return;
      const source = reference.source;
      const located = source?.version
        ? await findSharedSessionFileVersion(
            accessToken,
            endpoint,
            { ...source, version: source.version },
            controller.signal,
            shareToken
          )
        : source
          ? await findSharedSessionFile(
              accessToken,
              endpoint,
              source.orgId,
              source.sessionId,
              source.path,
              undefined,
              controller.signal,
              shareToken
            )
          : null;
      if (!stillCurrent()) return;
      if (reference.source && !located) {
        setError("not_uploaded");
        return;
      }
      const result = await readSharedSessionFile(
        accessToken,
        endpoint,
        located?.id ?? reference.id,
        controller.signal,
        shareToken
      );
      if (stillCurrent())
        setFile({ ...result, identity, requestKey, shareToken });
    })().catch(() => {
      if (stillCurrent()) setError("request_failed");
    });
    return () => controller.abort();
  }, [
    identity,
    openingIdentity,
    requestKey,
    token,
    store,
    shareToken,
    attempt,
  ]);
  const currentFile =
    identity === openingIdentity &&
    file?.identity === identity &&
    file.requestKey === requestKey &&
    file.shareToken === shareToken
      ? file
      : null;
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
          shareTokenRef.current === currentFile.shareToken &&
          org2CloudAuthIdentityKey(latest) === currentFile.identity &&
          getCloudEndpoint().supabaseUrl === reference.endpoint
        );
      });
      if (name) Message.success(t("sharedFile.downloaded"));
    } catch {
      Message.error(t("sharedFile.downloadError"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      data-testid="shared-file-preview"
      className="flex h-full min-h-0 flex-col bg-bg-1 text-text-1"
      aria-label={currentFile?.name ?? t("sharedFile.title")}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-1 px-3 py-2">
        <span className="min-w-0 truncate text-sm" title={currentFile?.name}>
          {currentFile?.name ??
            reference.source?.path.split(/[\\/]/).pop() ??
            t("sharedFile.title")}
        </span>
        <Button
          data-testid="shared-file-download"
          variant="tertiary"
          size="small"
          disabled={!currentFile}
          loading={saving}
          onClick={() => void download()}
        >
          {t("sharedFile.download")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {error ? (
          <>
            <p role="alert">
              {error === "not_uploaded"
                ? t("sharedFile.notUploaded")
                : t("sharedFile.error")}
            </p>
            <Button
              data-testid="shared-file-retry"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t("common:actions.retry")}
            </Button>
          </>
        ) : currentFile ? (
          <>
            {activeMedia ? (
              activeMedia.pdf ? (
                <iframe
                  title={currentFile.name}
                  src={activeMedia.url}
                  sandbox=""
                  className="min-h-0 w-full flex-1"
                />
              ) : (
                <img
                  src={activeMedia.url}
                  alt={currentFile.name}
                  className="min-h-0 max-w-full flex-1 object-contain"
                />
              )
            ) : preview !== null ? (
              <pre className="min-h-0 flex-1 overflow-auto font-mono text-sm break-words whitespace-pre-wrap">
                {preview}
              </pre>
            ) : (
              <p>{t("sharedFile.downloadPreview")}</p>
            )}
          </>
        ) : (
          <p role="status">{t("sharedFile.loading")}</p>
        )}
      </div>
    </section>
  );
}
