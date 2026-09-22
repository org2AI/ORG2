import type { MouseEvent, ReactNode } from "react";

import { Delete02Icon, HugeiconsIcon } from "@src/icons";

import Button from ".";

interface DeleteIconButtonProps {
  /**
   * Accessible name (`aria-label` + `title`). With `iconOnly={false}` it is
   * also the visible label.
   */
  label?: string;
  /** Importance; danger is carried by `tone`, never by a text color class. */
  variant?: "secondary" | "tertiary";
  size?: "small" | "default";
  /** @default true */
  iconOnly?: boolean;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
  /** In-flight removal: shows the spinner and blocks further clicks. */
  deleting?: boolean;
  disabled?: boolean;
  className?: string;
  dataTestId?: string;
}

/**
 * Standard destructive remove action for table rows, list rows and settings
 * sections: a trash glyph on a `tone="danger"` button. Danger comes from the
 * Button tone (importance lives on `variant`, intent on `tone`) rather than a
 * `text-danger-6` class on the icon, so the whole control — including a visible
 * label — stays on the design system's danger color ramp.
 */
export default function DeleteIconButton({
  label,
  variant = "secondary",
  size = "default",
  iconOnly = true,
  onDelete,
  deleting = false,
  disabled = false,
  className,
  dataTestId,
}: DeleteIconButtonProps): ReactNode {
  return (
    <Button
      htmlType="button"
      variant={variant}
      tone="danger"
      size={size}
      iconOnly={iconOnly}
      loading={deleting}
      disabled={disabled || deleting}
      aria-label={label}
      title={label}
      onClick={onDelete}
      className={className}
      icon={<HugeiconsIcon icon={Delete02Icon} data-icon="trash-2" size={14} />}
      data-testid={dataTestId}
    >
      {iconOnly ? null : label}
    </Button>
  );
}
