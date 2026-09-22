import Modal from "@/src/scaffold/ModalSystem";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { openLink } from "@src/util/ui/openLink";

import type {
  CanvasShareDialogError,
  CanvasShareDialogState,
} from "./useCanvasShareDialog";

interface CanvasShareDialogProps {
  state: CanvasShareDialogState;
  onClose: () => void;
  onRetry: () => void;
  onRetryShortLink: () => void;
  onCopy: () => void;
}

function errorMessage(
  error: CanvasShareDialogError,
  t: (key: string) => string
): string {
  switch (error) {
    case "source-too-large":
      return t("canvasApp.shareDialogTooLarge");
    case "short-unavailable-too-large":
      return t("canvasApp.shareDialogShortUnavailable");
    case "unsupported-runtime":
      return t("canvasApp.shareDialogUnsupported");
    case "invalid-payload":
      return t("canvasApp.shareDialogInvalid");
    default:
      return t("canvasApp.shareDialogError");
  }
}

const CanvasShareDialog: React.FC<CanvasShareDialogProps> = ({
  state,
  onClose,
  onRetry,
  onRetryShortLink,
  onCopy,
}) => {
  const { t, i18n } = useTranslation("sessions");
  const visible = state.phase !== "closed";
  const title = state.phase === "closed" ? "" : state.title;

  return (
    <Modal
      visible={visible}
      title={t("canvasApp.shareDialogTitle")}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      {state.phase !== "closed" ? (
        <div className="flex flex-col gap-4" data-testid="canvas-share-dialog">
          <div className="rounded-md border border-border-1 bg-fill-1 p-3">
            <div className="text-xs font-medium text-text-1">{title}</div>
            <div className="mt-1 text-xs leading-5 text-text-3">
              {t("canvasApp.shareDialogScope")}
            </div>
          </div>

          {state.phase === "preparing" ? (
            <div
              className="flex items-center gap-2 text-xs text-text-3"
              aria-live="polite"
            >
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-primary-6"
                aria-hidden
              />
              {t("canvasApp.shareDialogPreparing")}
            </div>
          ) : state.phase === "ready" ? (
            <div className="flex flex-col gap-3">
              <Input
                value={state.link}
                readOnly
                aria-label={t("canvasApp.shareDialogLink")}
                onFocus={(event) => event.currentTarget.select()}
                errorMessage={
                  state.copyError
                    ? t("canvasApp.shareDialogCopyFailed")
                    : undefined
                }
              />
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs text-text-4">
                  <div>{t("canvasApp.shareDialogPublic")}</div>
                  {state.linkKind === "short" && state.expiresAt ? (
                    <div className="mt-1">
                      {t("canvasApp.shareDialogShortExpiry", {
                        date: new Intl.DateTimeFormat(i18n.language, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }).format(new Date(state.expiresAt)),
                      })}
                    </div>
                  ) : state.linkKind === "self-contained" ? (
                    <div className="mt-1 text-warning-6">
                      {t("canvasApp.shareDialogFallback")}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {state.linkKind === "self-contained" ? (
                    <Button
                      loading={state.retryingShortLink}
                      disabled={state.retryingShortLink}
                      onClick={onRetryShortLink}
                    >
                      {state.retryingShortLink
                        ? t("canvasApp.shareDialogRetryingShort")
                        : t("canvasApp.shareDialogRetryShort")}
                    </Button>
                  ) : null}
                  <Button onClick={() => openLink(state.link)}>
                    {t("canvasApp.shareDialogOpen")}
                  </Button>
                  <Button variant="primary" onClick={onCopy}>
                    {state.copied
                      ? t("canvasApp.shareDialogCopied")
                      : t("canvasApp.shareDialogCopy")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="flex items-center justify-between gap-3"
              role="alert"
            >
              <span className="text-xs text-danger-6">
                {errorMessage(state.error, t)}
              </span>
              <Button onClick={onRetry}>{t("canvasApp.retry")}</Button>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
};

export default CanvasShareDialog;
