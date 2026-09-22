/**
 * Toast renderer for `Message` — split out of `index.tsx` so framer-motion
 * (and its icons) load lazily on the first toast instead of sitting in
 * the startup graph of every module that imports the `Message` API.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { FC } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import {
  SPOTLIGHT_TOP_OFFSET,
  readSpotlightAnchorStyle,
} from "@src/util/ui/spotlightAnchor";

import {
  DEFAULT_DURATION,
  type MessageConfig,
  type MessageItemProps,
  type MessagePlacement,
  type MessageType,
} from "./types";

// ============================================
// Config
// ============================================

const TYPE_STYLES: Record<MessageType, { border: string }> = {
  regular: {
    border: "border-border-2",
  },
  success: {
    border: "border-success-6/30",
  },
  error: {
    border: "border-danger-6/30",
  },
  warning: {
    border: "border-warning-6/30",
  },
  info: {
    border: "border-primary-6/30",
  },
};

// ============================================
// Message Item Component
// ============================================

const MessageItem = ({
  id,
  content,
  title,
  type = "info",
  duration = DEFAULT_DURATION,
  closable = true,
  onClose,
  onRemove,
  className = "",
  download,
  cancel,
  action,
  ref,
}: MessageItemProps) => {
  const { t } = useTranslation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    onRemove(id);
    onClose?.();
  }, [id, onRemove, onClose]);

  // Auto dismiss timer
  useEffect(() => {
    if (duration <= 0) return;

    timerRef.current = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [duration, handleClose]);

  const typeStyle = TYPE_STYLES[type];
  const handleDownload = useCallback(() => {
    const blob =
      download?.content instanceof Blob
        ? download.content
        : new Blob([download?.content ?? ""], {
            type: download?.mimeType ?? "text/plain;charset=utf-8",
          });

    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = download?.fileName ?? "message.txt";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(objectUrl);
  }, [download]);
  const handleCancelAction = useCallback(() => {
    cancel?.onClick?.();
    if (cancel?.closeOnClick !== false) {
      handleClose();
    }
  }, [cancel, handleClose]);
  const handlePrimaryAction = useCallback(() => {
    action?.onClick();
    if (action?.closeOnClick !== false) {
      handleClose();
    }
  }, [action, handleClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
      }}
      transition={{
        duration: 0.2,
        ease: "easeOut",
      }}
      className={`pointer-events-auto relative flex w-full cursor-default items-start gap-3 overflow-hidden rounded-xl border bg-bg-2 p-[14px_16px] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_24px_rgba(0,0,0,0.08)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_4px_8px_rgba(0,0,0,0.06),0_16px_32px_rgba(0,0,0,0.12)] max-[480px]:gap-2.5 max-[480px]:rounded-[10px] max-[480px]:p-[12px_14px] ${typeStyle.border} ${className}`}
    >
      {/* Content */}
      <div className="flex min-h-6 min-w-0 flex-1 flex-col justify-center gap-0.5">
        {title && (
          <div className="text-[13px] leading-[1.4] font-semibold tracking-[-0.01em] text-text-1 max-[480px]:text-xs">
            {title}
          </div>
        )}
        <div
          className={`text-[13px] leading-normal wrap-break-word max-[480px]:text-xs ${
            title ? "font-[450] text-text-2" : "font-medium text-text-1"
          }`}
        >
          {content}
        </div>
        {(download || cancel || action) && (
          <div className="mt-2 flex justify-end gap-3">
            {cancel && (
              <Button
                variant="ghost"
                size="inline"
                className="text-xs leading-[1.2] font-medium"
                onClick={handleCancelAction}
              >
                {cancel.label ?? t("actions.cancel")}
              </Button>
            )}
            {download && (
              <Button
                variant="ghost"
                size="inline"
                className="text-xs leading-[1.2] font-medium"
                onClick={handleDownload}
              >
                {download.label ?? t("actions.download")}
              </Button>
            )}
            {action && (
              <Button
                variant="ghost"
                size="inline"
                className="text-xs leading-[1.2] font-semibold"
                onClick={handlePrimaryAction}
              >
                {action.label}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Close button */}
      {closable && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          icon={<HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={14} />}
          className="ml-1 shrink-0 opacity-60 transition-all ease-out hover:text-text-1 hover:opacity-100 active:scale-95"
          onClick={handleClose}
          aria-label={t("actions.close")}
        />
      )}
    </motion.div>
  );
};

MessageItem.displayName = "MessageItem";

// ============================================
// Message Container Component
// ============================================

interface MessageContainerProps {
  messages: Map<string, MessageConfig>;
  onRemove: (id: string) => void;
}

const MessageContainer: FC<MessageContainerProps> = ({
  messages,
  onRemove,
}) => {
  const messagesByPlacement = (placement: MessagePlacement) =>
    Array.from(messages.entries()).filter(
      ([, config]) => (config.placement ?? "bottom") === placement
    );

  const renderMessages = (placement: MessagePlacement) => {
    const messageArray = messagesByPlacement(placement);
    if (messageArray.length === 0) return null;

    return (
      <AnimatePresence>
        {messageArray.map(([id, config]) => (
          <MessageItem key={id} id={id} {...config} onRemove={onRemove} />
        ))}
      </AnimatePresence>
    );
  };

  return (
    <div className="h-full w-full">
      {/* Anchored like the Spotlight palette: over the content area, same width. */}
      {messagesByPlacement("spotlight").length > 0 && (
        <div
          data-message-placement="spotlight"
          className="pointer-events-none absolute flex -translate-x-1/2 flex-col gap-2"
          style={{ top: SPOTLIGHT_TOP_OFFSET, ...readSpotlightAnchorStyle() }}
        >
          {renderMessages("spotlight")}
        </div>
      )}
      <div
        data-message-placement="bottom"
        className="pointer-events-none absolute right-4 bottom-4 flex w-auto max-w-[380px] flex-col-reverse items-end gap-2 max-[480px]:right-2 max-[480px]:bottom-2 max-[480px]:left-2 max-[480px]:max-w-full"
      >
        {renderMessages("bottom")}
      </div>
    </div>
  );
};

export default MessageContainer;
