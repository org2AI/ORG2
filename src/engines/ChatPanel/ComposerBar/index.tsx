/**
 * ComposerBar — shared bottom toolbar for input areas
 *
 * Used by both ChatPanel InputArea and SessionCreator EditorArea
 * to ensure identical layout: [+ button | mode | model] ---- [context | submit]
 *
 * When an editor slot is present, the editor uses the full-width row above
 * the shared toolbar controls, or sits between them in one row when
 * `inlineLayout` is set.
 */
import React, { memo } from "react";

import Button from "@src/components/Button";
import { PILL_CONTROL_HOVER_CLASS } from "@src/components/CompoundPill/config";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import ContextInfoButton from "@src/engines/ChatPanel/InputArea/components/ContextInfoButton";
import { Add01Icon, HugeiconsIcon } from "@src/icons";

// ============================================
// Types
// ============================================

interface ComposerBarProps {
  /** + button: open add-content selector (@-mentions, files) */
  onAddContent?: () => void;
  /** Content before the + button (e.g. cite-code badge, reply indicator) */
  leftPrefix?: React.ReactNode;
  /** Optional tools rendered after the + button. */
  leftTools?: React.ReactNode;
  /** Pills rendered after the + button (mode, model, source, settings…) */
  pills?: React.ReactNode;
  /** Model controls grouped after mode pills on the left. */
  modelPill?: React.ReactNode;
  /** Repo path forwarded to ContextInfoButton */
  repoPath?: string;
  /** Submit / launch button on the far right */
  submitButton?: React.ReactNode;
  /** Optional bottom padding for the toolbar row inside the composer shell. */
  bottomPaddingClassName?: string;
  /** Optional editor field above the toolbar. */
  editorSlot?: React.ReactNode;
  /**
   * Render the editor between the left and right controls in one row. The
   * editor slot keeps its DOM node when this flips, so focus, selection, and
   * the uncontrolled editor document survive compact/stacked moves.
   */
  inlineLayout?: boolean;
  /** Hide the default add-content button while preserving the shared layout. */
  hideAddButton?: boolean;
  /** Places add/tools/pills beside submit, leaving only the prefix on the left. */
  secondaryControlsPosition?: "left" | "right";
  /**
   * When false, omits ContextInfoButton.
   * @default true
   */
  showContextInfo?: boolean;
}

// ============================================
// Component
// ============================================

const ComposerBar: React.FC<ComposerBarProps> = memo(
  ({
    onAddContent,
    leftPrefix,
    leftTools,
    pills,
    modelPill,
    repoPath,
    submitButton,
    bottomPaddingClassName = "",
    editorSlot,
    inlineLayout = false,
    hideAddButton = false,
    secondaryControlsPosition = "left",
    showContextInfo = true,
  }) => {
    const rowClass = "flex min-w-0 items-center gap-0.5";

    const addButton =
      hideAddButton || !onAddContent ? null : (
        <Button
          layout="custom"
          onClick={onAddContent}
          onMouseDown={(e) => e.preventDefault()}
          className={[
            `flex items-center justify-center rounded-full text-text-1 transition-colors duration-200 focus:outline-none ${PILL_CONTROL_HOVER_CLASS}`,
            INPUT_AREA_BUTTONS.iconButtonSizeClass,
          ].join(" ")}
          aria-label="Add"
          data-testid="composer-add-context-button"
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={INPUT_AREA_BUTTONS.iconSize}
            strokeWidth={1.75}
            className="text-text-1"
          />
        </Button>
      );

    // The row's spare height sits above the 28px controls and it has no side
    // padding, so the controls rest on the shell inset exactly where the
    // inline row puts them: + and send stay put across compact/stacked moves.
    const toolbarRow = (
      <div
        key="toolbar"
        className={`flex h-9 min-h-9 w-full items-center justify-between pt-2 text-text-2 ${bottomPaddingClassName}`.trim()}
        style={{ transform: "translateZ(0)" }}
      >
        <div className={rowClass}>
          {leftPrefix}
          {secondaryControlsPosition === "left" ? (
            <>
              {addButton}
              {leftTools}
              {pills}
              {modelPill}
            </>
          ) : null}
        </div>
        <div className={rowClass}>
          {secondaryControlsPosition === "right" ? (
            <>
              {addButton}
              {leftTools}
              {pills}
              {modelPill}
            </>
          ) : null}
          {showContextInfo && <ContextInfoButton repoPath={repoPath} />}
          {submitButton}
        </div>
      </div>
    );

    if (editorSlot == null) return toolbarRow;

    // Both layouts render this node as a keyed direct child of the same root,
    // so React never remounts or moves the editor when `inlineLayout` flips.
    const editorSlotNode = (
      <div
        key="editor"
        data-editor-slot="true"
        className={`relative flex min-h-0 min-w-0 items-stretch self-stretch ${inlineLayout ? "flex-1" : ""}`.trim()}
      >
        {editorSlot}
      </div>
    );

    if (inlineLayout) {
      return (
        <div
          className={`flex w-full min-w-0 items-center gap-1.5 text-text-2 ${bottomPaddingClassName}`.trim()}
        >
          <div key="left" className={`${rowClass} shrink-0`}>
            {leftPrefix}
            {addButton}
            {leftTools}
            {pills}
            {modelPill}
          </div>
          {editorSlotNode}
          <div key="right" className={`${rowClass} shrink-0`}>
            {showContextInfo && (
              <ContextInfoButton repoPath={repoPath} variant="corner" compact />
            )}
            {submitButton}
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col gap-2">
        {editorSlotNode}
        {toolbarRow}
      </div>
    );
  }
);

ComposerBar.displayName = "ComposerBar";

export default ComposerBar;
