/**
 * Shared Allow / Deny / Always Allow actions for permission prompts.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

export interface PermissionPromptActionsProps {
  layout?: "compact" | "mobile";
  disabled?: boolean;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  onAllow?: () => void;
}

export function PermissionPromptActions({
  layout = "compact",
  disabled = false,
  onDeny,
  onAlwaysAllow,
  onAllow,
}: PermissionPromptActionsProps) {
  const { t } = useTranslation("sessions");
  const noop = useCallback(() => {}, []);

  if (layout === "mobile") {
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          className="w-full"
          style={{
            fontSize: "var(--mobile-type-control-size, 13px)",
            lineHeight: "var(--mobile-type-control-leading, 1.4)",
          }}
          onClick={onAllow ?? noop}
          disabled={disabled}
        >
          {t("chat.allow")}
        </Button>
        <Button
          tone="danger"
          className="w-full"
          style={{
            fontSize: "var(--mobile-type-control-size, 13px)",
            lineHeight: "var(--mobile-type-control-leading, 1.4)",
          }}
          onClick={onDeny ?? noop}
          disabled={disabled}
        >
          {t("chat.deny")}
        </Button>
        <Button
          variant="tertiary"
          className="w-full"
          style={{
            fontSize: "var(--mobile-type-control-size, 13px)",
            lineHeight: "var(--mobile-type-control-leading, 1.4)",
          }}
          onClick={onAlwaysAllow ?? noop}
          disabled={disabled}
        >
          {t("chat.alwaysAllow")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="tertiary"
        size="mini"
        onClick={onDeny ?? noop}
        disabled={disabled}
      >
        {t("chat.deny")}
      </Button>
      <Button size="mini" onClick={onAlwaysAllow ?? noop} disabled={disabled}>
        {t("chat.alwaysAllow")}
      </Button>
      <Button
        variant="primary"
        size="mini"
        onClick={onAllow ?? noop}
        disabled={disabled}
      >
        {t("chat.allow")}
      </Button>
    </div>
  );
}

PermissionPromptActions.displayName = "PermissionPromptActions";
