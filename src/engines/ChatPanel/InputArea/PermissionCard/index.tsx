/**
 * PermissionCard Component
 *
 * Displays pending permission requests from OS Agent, SDE Agent, and Custom Agents.
 * Allows the user to Approve, Deny, or Always Allow tool executions.
 * Renders the session-scoped pending permission store populated by the agent
 * event handler, so requests survive component remounts and session switches.
 *
 * Delegates all rendering to PermissionCardBody (shared with ApprovalPreview).
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  respondCliHookPermission,
  respondPermission,
} from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import {
  clearPendingPermissionRequest,
  getPendingPermissionRequests,
  pendingPermissionRequestsAtom,
  permissionRequestsForSessionAtomFamily,
  reconcileNativePermissionSnapshot,
} from "@src/store/session/permissionRequestAtom";

import { PermissionCardBody } from "./PermissionCardBody";

const log = createLogger("PermissionCard");

function buildArgsPreview(args: Record<string, unknown>, full = false) {
  return Object.entries(args)
    .slice(0, full ? undefined : 5)
    .map(([key, value]) => {
      const strValue =
        typeof value === "string" ? value : JSON.stringify(value);
      const truncated =
        !full && strValue.length > 120
          ? `${strValue.slice(0, 120)}...`
          : strValue;
      return { key, value: truncated };
    });
}

interface PermissionCardProps {
  sessionId?: string | null;
  collapsed?: boolean;
  onCollapse?: () => void;
  onHasDataChange?: (hasData: boolean) => void;
}

const PermissionCard: React.FC<PermissionCardProps> = ({
  sessionId,
  collapsed,
  onCollapse,
  onHasDataChange,
}) => {
  const { t } = useTranslation("sessions");
  const queue = useAtomValue(
    permissionRequestsForSessionAtomFamily(sessionId ?? "")
  );
  const setPermissionMap = useSetAtom(pendingPermissionRequestsAtom);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const store = useStore();

  const pending = queue.length > 0 ? queue[0] : null;

  useEffect(() => {
    setIsSubmitting(false);
    if (!sessionId) return;
    const baselineIds = new Set(
      getPendingPermissionRequests(
        store.get(pendingPermissionRequestsAtom),
        sessionId
      )
        .filter((request) => request.origin === "native_cli")
        .map((request) => request.requestId)
    );
    let disposed = false;
    const resolvedIds = new Set<string>();
    let snapshotPending = true;
    const resolved = (evt: Event) => {
      const detail = (
        evt as CustomEvent<{ sessionId: string; requestId: string }>
      ).detail;
      if (detail.sessionId === sessionId && snapshotPending) {
        resolvedIds.add(detail.requestId);
      }
    };
    window.addEventListener("native-interaction-resolved", resolved);
    void invoke<
      Array<{
        requestId: string;
        toolName?: string;
        toolArgs?: Record<string, unknown>;
        origin?: string;
      }>
    >("cli_native_pending_interactions", { sessionId })
      .then((rows) => {
        if (disposed) return;
        const pendingRows = rows.filter(
          (row) =>
            row.origin === "native_cli" && !resolvedIds.has(row.requestId)
        );
        setPermissionMap((previous) =>
          reconcileNativePermissionSnapshot(
            previous,
            sessionId,
            baselineIds,
            pendingRows.map((row) => ({
              requestId: row.requestId,
              sessionId,
              tool: row.toolName ?? "",
              args: row.toolArgs ?? {},
              origin: "native_cli" as const,
            }))
          )
        );
      })
      .catch((error) => log.error("Failed to load native approvals", error))
      .finally(() => {
        snapshotPending = false;
        resolvedIds.clear();
      });
    return () => {
      disposed = true;
      window.removeEventListener("native-interaction-resolved", resolved);
    };
  }, [sessionId, setPermissionMap, store]);

  const respond = useCallback(
    async (response: "allow" | "deny" | "always_allow") => {
      if (!pending) return;
      setIsSubmitting(true);
      const respondingId = pending.requestId;
      try {
        if (
          pending.origin === "cli_hook" ||
          pending.origin === "acp" ||
          pending.origin === "native_cli"
        ) {
          // Managed CLI session: the approval is parked in a CLI-side
          // registry (Claude PermissionRequest hook long-poll or an ACP
          // agent's session/request_permission), not the Rust-agent
          // permission manager.
          await respondCliHookPermission(
            pending.sessionId ?? "",
            pending.requestId,
            response
          );
        } else {
          await respondPermission(
            pending.sessionId ?? "",
            pending.requestId,
            response,
            pending.tool,
            pending.args
          );
        }
        setPermissionMap((prev) =>
          clearPendingPermissionRequest(prev, pending.sessionId, respondingId)
        );
      } catch (err) {
        log.error("[PermissionCard] Failed to respond:", err);
        Message.error(t("chat.permissionFailed"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [pending, setPermissionMap, t]
  );

  useEffect(() => {
    onHasDataChange?.(queue.length > 0);
  }, [queue.length, onHasDataChange]);

  if (!pending) return null;

  const isCommandConfirm = pending.tool === "exec:command-confirm";

  return (
    <PermissionCardBody
      collapsed={collapsed}
      onCollapse={onCollapse}
      label={
        isCommandConfirm
          ? t("chat.commandConfirmTitle", "Command Requires Approval")
          : t("chat.permissionPrompt", "Your permission is needed")
      }
      badge={
        queue.length > 1 ? (
          <span className="text-[10px] text-text-3">+{queue.length - 1}</span>
        ) : undefined
      }
      commandText={
        isCommandConfirm && typeof pending.args.command === "string"
          ? pending.args.command
          : null
      }
      description={
        isCommandConfirm && typeof pending.args.reason === "string"
          ? pending.args.reason
          : null
      }
      argsPreview={
        isCommandConfirm
          ? []
          : buildArgsPreview(pending.args, pending.origin === "native_cli")
      }
      onDeny={() => respond("deny")}
      showAlwaysAllow={pending.origin !== "native_cli"}
      onAlwaysAllow={() => respond("always_allow")}
      onAllow={() => respond("allow")}
      disabled={isSubmitting}
    />
  );
};

PermissionCard.displayName = "PermissionCard";

export default PermissionCard;
