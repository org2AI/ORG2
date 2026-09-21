import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { isMacOS, isWindows } from "@src/util/platform/tauri";
import { popupNativeMenu } from "@src/util/platform/tauri/nativeMenuPopup";

import { useImageAttachmentTarget } from "./context";
import {
  type ImageActionSource,
  copyDisplayedImage,
  copyNativeImage,
  downloadImage,
  imageFileName,
  readActionImage,
  revealImage,
} from "./imageOperations";

export function useImageActions(
  source: ImageActionSource,
  options: {
    allowAdd?: boolean;
    allowCopy?: boolean;
    onAdded?: () => void;
  } = {}
) {
  const { t } = useTranslation("common");
  const targetRef = useImageAttachmentTarget();
  const operation = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<{
    src: string;
    localPath?: string;
    controller: AbortController;
  } | null>(null);
  const busy =
    pending?.src === source.src &&
    pending.localPath === source.localPath &&
    !pending.controller.signal.aborted;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    operation.current = null;
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [source.src, source.localPath]);

  const run = (
    action: (signal: AbortSignal) => Promise<void>,
    errorKey = "imageActions.failed"
  ) => {
    if (operation.current || lifetime.current?.signal.aborted) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending({ src: source.src, localPath: source.localPath, controller });
    // Invoke synchronously: the browser clipboard path needs user activation.
    void action(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) Message.error(t(errorKey));
      })
      .finally(() => {
        if (operation.current === controller) {
          operation.current = null;
          if (!controller.signal.aborted) setPending(null);
        }
      });
  };

  const openMenu = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const controller = lifetime.current;
    const target = targetRef?.current;
    const available = Boolean(source.src) && !operation.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      "clientX" in event
        ? new LogicalPosition(event.clientX, event.clientY)
        : new LogicalPosition(rect.left, rect.bottom);
    void popupNativeMenu({
      source: "chat-image",
      at,
      fallbackToCursor: true,
      buildItems: () => [
        ...(options.allowAdd === false
          ? []
          : [
              {
                text: t("imageActions.addToChat"),
                enabled: available && Boolean(target && !target.signal.aborted),
                action: () => {
                  if (
                    !target ||
                    target.signal.aborted ||
                    targetRef?.current !== target ||
                    controller?.signal.aborted
                  )
                    return;
                  run(async (signal) => {
                    // A chat can switch while React reuses the same image URL.
                    // Bind I/O to the composer as well as the image lifetime.
                    const abortRead = new AbortController();
                    const abort = () => abortRead.abort();
                    signal.addEventListener("abort", abort, { once: true });
                    target.signal.addEventListener("abort", abort, {
                      once: true,
                    });
                    let blob: Blob;
                    try {
                      blob = await readActionImage(source, abortRead.signal);
                    } catch (error) {
                      if (target.signal.aborted || signal.aborted) return;
                      throw error;
                    } finally {
                      signal.removeEventListener("abort", abort);
                      target.signal.removeEventListener("abort", abort);
                    }
                    if (target.signal.aborted || targetRef?.current !== target)
                      return;
                    const count = await target.add(
                      new File([blob], imageFileName(source, blob.type), {
                        type: blob.type,
                      }),
                      signal
                    );
                    if (count && !target.signal.aborted && !signal.aborted) {
                      options.onAdded?.();
                      target.focus();
                      Message.success(t("imageActions.added"));
                    }
                  });
                },
              },
            ]),
        ...(options.allowCopy === false
          ? []
          : [
              {
                text: t("imagePreview.copyImage"),
                enabled: available,
                action: () => {
                  if (controller?.signal.aborted) return;
                  run(async (signal) => {
                    await copyNativeImage(source, signal);
                    if (!signal.aborted)
                      Message.success(t("imagePreview.copiedToClipboard"));
                  }, "errors.failedToCopy");
                },
              },
            ]),
        {
          text: t(
            isMacOS()
              ? "actions.revealInFinder"
              : isWindows()
                ? "actions.revealInWindowsExplorer"
                : "actions.revealInFileManager"
          ),
          enabled: Boolean(source.localPath) && !operation.current,
          action: () => {
            if (!controller?.signal.aborted)
              run(async () => revealImage(source));
          },
        },
        {
          text: t("imageActions.downloadCopy"),
          enabled: available,
          action: () => {
            if (!controller?.signal.aborted)
              run((signal) => downloadImage(source, signal));
          },
        },
      ],
    }).catch(() => {
      if (!controller?.signal.aborted) Message.error(t("imageActions.failed"));
    });
  };

  return {
    busy,
    onContextMenu: openMenu,
    onKeyDown: (event: KeyboardEvent) => {
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      )
        openMenu(event);
    },
    copy: (image: HTMLImageElement | null) =>
      run(async (signal) => {
        await copyDisplayedImage(image);
        if (!signal.aborted)
          Message.success(t("imagePreview.copiedToClipboard"));
      }, "errors.failedToCopy"),
    download: () => run((signal) => downloadImage(source, signal)),
  };
}
