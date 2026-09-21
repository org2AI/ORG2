/**
 * PermissionSheet — mobile remote permission approval surface.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import BottomSheet from "@src/components/BottomSheet";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/PageNotice";
import { HugeiconsIcon, NotificationBubbleIcon } from "@src/icons";

import { PermissionPromptActions } from "./PermissionPromptActions";
import { PermissionPromptContent } from "./PermissionPromptContent";
import {
  type PermissionArgPreview,
  resolvePermissionPromptViewModel,
} from "./permissionPromptHelpers";

export interface PermissionSheetRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolCallId?: string;
  toolArgs: Record<string, unknown>;
  toolArgsTruncated?: boolean;
  origin?: "rust_agent" | "cli_hook" | "acp";
}

export interface PermissionSheetProps {
  open: boolean;
  request: PermissionSheetRequest | null;
  desktopName?: string;
  queueDepth?: number;
  submitting?: boolean;
  notice?: string;
  error?: string;
  onDeny: () => void;
  onAllow: () => void;
  onAlwaysAllow: () => void;
  /**
   * Removes this prompt from the client queue without answering it — the
   * escape hatch for a prompt the desktop already resolved, cancelled, or
   * timed out. The managed CLI and ACP registries broadcast nothing when that
   * happens, so a stale prompt would otherwise sit here indefinitely.
   */
  onDismiss?: () => void;
}

export function PermissionSheet({
  open,
  request,
  desktopName,
  queueDepth = 0,
  submitting = false,
  notice,
  error,
  onDeny,
  onAllow,
  onAlwaysAllow,
  onDismiss,
}: PermissionSheetProps) {
  const { t } = useTranslation("sessions");

  if (!request) return null;

  const viewModel = resolvePermissionPromptViewModel({
    tool: request.toolName,
    args: request.toolArgs,
    permissionPromptLabel: t(
      "chat.permissionPrompt",
      "Your permission is needed"
    ),
    commandConfirmTitle: t(
      "chat.commandConfirmTitle",
      "Command Requires Approval"
    ),
  });

  const footerNote =
    desktopName &&
    t(
      "chat.remoteExecutionNotice",
      "This action will run on {{desktopName}}.",
      {
        desktopName,
      }
    );

  const badge =
    queueDepth > 1 ? (
      <span
        style={{ fontSize: "var(--mobile-type-caption-size, 12px)" }}
        className="ml-2 text-xs text-text-3"
      >
        +{queueDepth - 1}
      </span>
    ) : null;

  return (
    <BottomSheet
      open={open}
      dismissible={false}
      title={
        <span className="inline-flex items-center gap-2">
          <HugeiconsIcon icon={NotificationBubbleIcon} size={16} />
          <span>{viewModel.label}</span>
          {badge}
          {!viewModel.commandText && request.toolName ? (
            <span
              style={{ fontSize: "var(--mobile-type-caption-size, 12px)" }}
              className="rounded bg-fill-2 px-1.5 py-0.5 text-xs font-medium text-text-2"
            >
              {request.toolName}
            </span>
          ) : null}
        </span>
      }
      footer={
        <PermissionPromptActions
          layout="mobile"
          disabled={submitting || request.toolArgsTruncated === true}
          onDeny={onDeny}
          onAllow={onAllow}
          onAlwaysAllow={onAlwaysAllow}
        />
      }
    >
      <PermissionPromptContent
        typography="mobile"
        commandText={viewModel.commandText}
        description={viewModel.description}
        argsPreview={viewModel.argsPreview as PermissionArgPreview[]}
        footerNote={footerNote || undefined}
      />
      {notice ? (
        <p
          style={{
            fontSize: "var(--mobile-type-secondary-size, 14px)",
            lineHeight: "var(--mobile-type-body-leading, 1.5)",
          }}
          role="status"
          className="mt-3 text-sm text-text-2"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <InlineAlert
          type="danger"
          role="alert"
          className="mt-3"
          bodyClassName="mobile-type-secondary"
        >
          {error}
        </InlineAlert>
      ) : null}
      {onDismiss ? (
        <Button
          variant="tertiary"
          size="mini"
          style={{
            minHeight: "var(--modal-action-size, 24px)",
            height: "auto",
            fontSize: "var(--mobile-type-caption-size, 12px)",
            lineHeight: "var(--mobile-type-caption-leading, 1.4)",
          }}
          className="mt-3 w-full text-center text-xs"
          onClick={onDismiss}
        >
          {t("chat.permissionDismiss", "Dismiss on this device")}
        </Button>
      ) : null}
    </BottomSheet>
  );
}

PermissionSheet.displayName = "PermissionSheet";

export default PermissionSheet;
