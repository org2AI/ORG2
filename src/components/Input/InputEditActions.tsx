/**
 * Check / x actions rendered inside an Input's trailing edge.
 *
 * Split from Input so the translation subscription only exists on fields that
 * actually render edit actions.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button, { type ButtonProps } from "@src/components/Button";
import { Cancel01Icon, HugeiconsIcon, Tick01Icon } from "@src/icons";

type InputSize = "mini" | "small" | "default" | "large";

/**
 * Each button is 3px inside the field border on every side (1px on mini,
 * whose 24px height leaves no room for a smaller preset); the matching
 * trailing padding lives in index.scss.
 */
const ACTION_BUTTON_SIZE: Record<
  InputSize,
  { size: NonNullable<ButtonProps["size"]>; iconSize: number }
> = {
  mini: { size: "inline", iconSize: 12 },
  small: { size: "sidebar", iconSize: 14 },
  default: { size: "mini", iconSize: 14 },
  large: { size: "small", iconSize: 14 },
};

/** Concentric with the field's 8px corner at a 3px inset. */
const ACTION_BUTTON_STYLE: React.CSSProperties = {
  borderRadius: "var(--radius-sm)",
};

/** Keep focus (and the focus ring) on the input while an action is clicked. */
const keepInputFocus = (event: React.MouseEvent) => event.preventDefault();

export interface InputEditActionsProps {
  size: InputSize;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmDisabled: boolean;
  confirmLoading: boolean;
  cancelDisabled: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const InputEditActions: React.FC<InputEditActionsProps> = ({
  size,
  onConfirm,
  onCancel,
  confirmDisabled,
  confirmLoading,
  cancelDisabled,
  confirmLabel,
  cancelLabel,
}) => {
  const { t } = useTranslation("common");
  const { size: buttonSize, iconSize } = ACTION_BUTTON_SIZE[size];
  const resolvedConfirmLabel = confirmLabel ?? t("actions.save");
  const resolvedCancelLabel = cancelLabel ?? t("actions.cancel");

  return (
    <span className="input-edit-actions">
      {onCancel && (
        <Button
          variant="tertiary"
          size={buttonSize}
          iconOnly
          icon={
            <HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={iconSize} />
          }
          className="input-cancel"
          hoverTone="danger"
          style={ACTION_BUTTON_STYLE}
          tabIndex={-1}
          disabled={cancelDisabled}
          onMouseDown={keepInputFocus}
          onClick={onCancel}
          aria-label={resolvedCancelLabel}
          title={resolvedCancelLabel}
        />
      )}
      {onConfirm && (
        <Button
          variant="tertiary"
          size={buttonSize}
          iconOnly
          icon={
            <HugeiconsIcon
              icon={Tick01Icon}
              data-icon="check"
              size={iconSize}
            />
          }
          className="input-confirm"
          hoverTone="primary"
          style={ACTION_BUTTON_STYLE}
          tabIndex={-1}
          disabled={confirmDisabled}
          loading={confirmLoading}
          onMouseDown={keepInputFocus}
          onClick={onConfirm}
          aria-label={resolvedConfirmLabel}
          title={resolvedConfirmLabel}
        />
      )}
    </span>
  );
};
