import type React from "react";

export interface SplitListHeaderProps {
  /** Context and navigation controls rendered below search in split mode. */
  primary?: React.ReactNode;
  /** Search and actions rendered in the top row in split mode. */
  secondary?: React.ReactNode;
  /** Use the full-width trailing inset; keep the list's left alignment. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * Surface-owned header rows for a split list. This replaces a shell-wide
 * tab-header strip when a tab keeps its list and detail panes visible.
 */
const SplitListHeader: React.FC<SplitListHeaderProps> = ({
  primary,
  secondary,
  fullWidth = false,
  className = "",
}) => {
  if (!primary && !secondary) return null;

  return (
    <div
      className={`flex shrink-0 flex-col bg-chat-pane ${className}`.trim()}
      data-split-list-header="true"
    >
      {(fullWidth ? ["primary", "secondary"] : ["secondary", "primary"]).map(
        (row) => {
          const content = row === "primary" ? primary : secondary;
          return content ? (
            <div
              key={row}
              className={`flex h-9 min-w-0 items-center gap-px ${
                fullWidth ? "pr-[7px] pl-3" : "px-3"
              }`}
              data-split-list-header-row={row}
            >
              {content}
            </div>
          ) : null;
        }
      )}
    </div>
  );
};

export default SplitListHeader;
