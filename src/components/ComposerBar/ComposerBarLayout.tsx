import React, { memo } from "react";

export interface ComposerBarLayoutProps {
  editorSlot: React.ReactNode;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  /** Horizontal padding for the footer toolbar row (defaults to desktop `px-1`). */
  toolbarPaddingClassName?: string;
  /** Shell-owned toolbar density; defaults to the desktop row. */
  toolbarClassName?: string;
}

/**
 * Browser-safe composer layout used by the Mobile Remote composer. Product-
 * specific controls are supplied through slots so the mobile bundle does not
 * need to import Desktop menus, context, or Tauri actions.
 */
const ComposerBarLayout: React.FC<ComposerBarLayoutProps> = memo(
  ({
    editorSlot,
    leftContent,
    rightContent,
    toolbarPaddingClassName = "px-1",
    toolbarClassName = "",
  }) => {
    const rowClass = "flex min-w-0 items-center gap-0.5";
    return (
      <div
        className="flex w-full flex-col gap-2"
        data-composer-bar-layout="true"
      >
        <div
          data-editor-slot="true"
          className="relative flex min-h-0 min-w-0 items-stretch self-stretch"
        >
          {editorSlot}
        </div>
        <div
          className={`flex h-9 min-h-9 w-full items-center justify-between ${toolbarPaddingClassName} text-text-2 ${toolbarClassName}`.trim()}
          style={{ transform: "translateZ(0)" }}
        >
          <div className={`${rowClass} flex-1`}>{leftContent}</div>
          <div className={rowClass}>{rightContent}</div>
        </div>
      </div>
    );
  }
);

ComposerBarLayout.displayName = "ComposerBarLayout";

export default ComposerBarLayout;
