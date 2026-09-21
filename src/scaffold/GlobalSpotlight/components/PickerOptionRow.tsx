import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

import Button from "@src/components/Button";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import type { UseDropdownListNavigationReturn } from "@src/hooks/dropdown";

interface PickerOptionRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "role"
> {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Separate from activation so editable variants never nest buttons. */
  trailing?: ReactNode;
  testId?: string;
  className?: string;
  role?: "menuitem" | "option";
  keyboardProps?: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
  onRowEnter?: (element: HTMLDivElement) => void;
  modelAnchor?: boolean;
}

/** Compact compound row; geometry belongs to the frame, activation to shared Button. */
export const PickerOptionRow = forwardRef<HTMLDivElement, PickerOptionRowProps>(
  function PickerOptionRow(
    {
      label,
      description,
      icon,
      selected = false,
      disabled = false,
      trailing,
      testId,
      className = "",
      role,
      keyboardProps,
      onRowEnter,
      modelAnchor,
      onMouseEnter,
      ...props
    },
    ref
  ) {
    return (
      <div
        {...props}
        ref={ref}
        data-dropdown-model-row-anchor={modelAnchor || undefined}
        data-dropdown-keyboard-highlight={
          keyboardProps?.["data-dropdown-keyboard-highlight"]
        }
        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} ${selected ? DROPDOWN_CLASSES.itemSelected : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          keyboardProps?.onMouseEnter();
          onRowEnter?.(event.currentTarget);
        }}
      >
        <Button
          {...keyboardProps}
          onMouseEnter={undefined}
          layout="custom"
          disabled={disabled}
          role={role}
          data-testid={testId}
          className="flex h-full min-w-0 flex-1 items-center justify-start gap-2 self-stretch text-left"
        >
          {(selected || icon) && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {selected ? <DropdownSelectedCheck /> : icon}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="w-full truncate">{label}</span>
            {description && (
              <span className="w-full truncate text-[11px] text-text-3">
                {description}
              </span>
            )}
          </span>
        </Button>
        {trailing && (
          <div className="relative flex shrink-0 items-center gap-1">
            {trailing}
          </div>
        )}
      </div>
    );
  }
);
