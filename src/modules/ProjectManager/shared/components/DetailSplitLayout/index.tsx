/**
 * DetailSplitLayout Component
 *
 * Reusable layout for creation panels in Project Manager.
 * Provides:
 *   - Title + header actions published into the Workstation tab header
 *   - Split panel: left content area + resizable right sidebar
 *   - Optional footer
 *
 * Used by:
 *   - CreateProjectView (create)
 *   - CreateWorkItemView (create)
 */
import React, { useCallback, useState } from "react";

import { PANEL_FOOTER_TOKENS } from "@src/components/layout/blocks";
import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import { useResizeHandle } from "@src/hooks/ui/useResizeHandle";
import ProjectManagerBreadcrumb from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import { VerticalResizeHandle } from "@src/scaffold/Resize";

// ============================================
// Types
// ============================================

export interface DetailSplitLayoutProps {
  /** Title shown in the published Workstation tab header */
  title: string;
  /** Optional extra actions rendered in the header (e.g. close button) */
  headerActions?: React.ReactNode;
  /** Left panel content (main content area) */
  leftContent: React.ReactNode;
  /** Right panel content (properties sidebar); rendered in a resizable column */
  rightContent?: React.ReactNode;
  /** Optional footer (e.g. Cancel / Create buttons) */
  footer?: React.ReactNode;
  /** Publish header content into the global WorkstationTabHeader. */
  publishHeaderToWorkstation?: boolean;
}

// ============================================
// Component
// ============================================

const DETAIL_SPLIT_DEFAULT_RIGHT_PANEL_WIDTH = 280;
const DETAIL_SPLIT_MIN_RIGHT_PANEL_WIDTH = 250;
const DETAIL_SPLIT_MAX_RIGHT_PANEL_WIDTH = 420;

const DetailSplitLayout: React.FC<DetailSplitLayoutProps> = ({
  title,
  headerActions,
  leftContent,
  rightContent,
  footer,
  publishHeaderToWorkstation = false,
}) => {
  const [rightPanelWidth, setRightPanelWidth] = useState(
    DETAIL_SPLIT_DEFAULT_RIGHT_PANEL_WIDTH
  );
  const handleRightPanelWidthChange = useCallback(
    (nextWidth: number) => setRightPanelWidth(nextWidth),
    []
  );
  const { handleMouseDown: handleRightPanelResize, isResizing } =
    useResizeHandle(rightPanelWidth, handleRightPanelWidthChange, {
      direction: "horizontal",
      minSize: DETAIL_SPLIT_MIN_RIGHT_PANEL_WIDTH,
      maxSize: DETAIL_SPLIT_MAX_RIGHT_PANEL_WIDTH,
      isReversed: true,
    });

  usePublishWorkstationTabHeader({
    host: "project",
    content: {
      content: <ProjectManagerBreadcrumb segments={[{ label: title }]} />,
      trailing: (
        <div className="flex shrink-0 items-center gap-px">{headerActions}</div>
      ),
    },
    enabled: publishHeaderToWorkstation,
  });

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">{leftContent}</div>

        {rightContent && (
          <>
            <VerticalResizeHandle
              onMouseDown={handleRightPanelResize}
              isResizing={isResizing}
            />
            <div
              className="min-w-0 shrink-0 overflow-hidden"
              style={{ width: rightPanelWidth }}
            >
              {rightContent}
            </div>
          </>
        )}
      </div>

      {footer && (
        <div className={`${PANEL_FOOTER_TOKENS.container} justify-end`}>
          {footer}
        </div>
      )}
    </div>
  );
};

export default DetailSplitLayout;
