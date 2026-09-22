import React, {
  type ComponentProps,
  memo,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import DetailHeaderIconAction from "@src/components/DetailHeaderIconAction";
import { Placeholder } from "@src/components/Placeholder";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PanelHeader,
  type PanelHeaderProps,
} from "@src/components/layout/blocks";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";
import {
  DETAIL_PANE_CLOSE_ATTRIBUTE,
  DETAIL_PANE_SHORTCUT_CLOSE_EVENT,
} from "@src/util/dom/detailPaneClose";

import { DetailPaneShortcutCloseContext } from "./detailPaneShortcutClose";

export type DetailPaneHeaderProps = Omit<
  PanelHeaderProps,
  "borderBottom" | "className" | "height"
>;

export interface DetailPaneLayoutProps {
  /** Domain-owned identity rendered in the shared 36px detail header. */
  header?: DetailPaneHeaderProps;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
  dataAttributes?: Record<
    `data-${string}`,
    boolean | number | string | undefined
  >;
  /** Standard right-edge close action, including header-only empty panes. */
  onClose?: () => void;
  closeTestId?: string;
}

export interface DetailPaneCloseActionProps {
  onClose: () => void;
  testId?: string;
}

const CLOSE_ACTION_MARKER = { [DETAIL_PANE_CLOSE_ATTRIBUTE]: "" };

/**
 * One close action shared by detail headers and tab strips. The marker lets
 * the close-tab chord dismiss the open detail before it closes the tab.
 */
export const DetailPaneCloseAction: React.FC<DetailPaneCloseActionProps> = memo(
  ({ onClose, testId }) => {
    const { t } = useTranslation("common");
    const markerRef = useRef<HTMLSpanElement>(null);
    const onShortcutClose = useContext(DetailPaneShortcutCloseContext);
    const shortcutClose = onShortcutClose ?? onClose;
    useEffect(() => {
      const marker = markerRef.current;
      if (!marker) return undefined;
      marker.addEventListener(DETAIL_PANE_SHORTCUT_CLOSE_EVENT, shortcutClose);
      return () =>
        marker.removeEventListener(
          DETAIL_PANE_SHORTCUT_CLOSE_EVENT,
          shortcutClose
        );
    }, [shortcutClose]);
    return (
      <span ref={markerRef} className="contents" {...CLOSE_ACTION_MARKER}>
        <DetailHeaderIconAction
          label={t("actions.close")}
          icon={
            <HugeiconsIcon
              icon={Cancel01Icon}
              data-icon="x"
              size={HEADER_ICON_SIZE.sm}
              strokeWidth={1.75}
              aria-hidden
            />
          }
          onClick={onClose}
          testId={testId}
        />
      </span>
    );
  }
);

DetailPaneCloseAction.displayName = "DetailPaneCloseAction";

/**
 * Canonical right-hand pane for Inbox-style list/detail surfaces.
 *
 * The shell owns responsive containment, header geometry, and the full-height
 * body. Domains own only header content/actions and the detail body itself.
 */
const DetailPaneLayout: React.FC<DetailPaneLayoutProps> = memo(
  ({
    header,
    children,
    className = "",
    testId,
    rootProps,
    dataAttributes,
    onClose,
    closeTestId,
  }) => {
    const resolvedHeader =
      header || onClose
        ? {
            ...header,
            actions: onClose ? (
              <div className="flex shrink-0 items-center gap-px">
                {header?.actions}
                <DetailPaneCloseAction onClose={onClose} testId={closeTestId} />
              </div>
            ) : (
              header?.actions
            ),
          }
        : undefined;

    return (
      <DetailPanelContainer
        className={className}
        testId={testId}
        rootProps={rootProps}
        dataAttributes={{
          ...dataAttributes,
          "data-detail-pane-layout": "true",
        }}
      >
        {resolvedHeader ? (
          <PanelHeader
            {...resolvedHeader}
            borderBottom
            height="detail"
            className={DETAIL_PANEL_TOKENS.headerPadding}
          />
        ) : null}
        <div
          className="@container flex min-h-0 flex-1 flex-col overflow-hidden"
          data-detail-pane-body
        >
          {children}
        </div>
      </DetailPanelContainer>
    );
  }
);

DetailPaneLayout.displayName = "DetailPaneLayout";

type PlaceholderProps = ComponentProps<typeof Placeholder>;

export type DetailPanePlaceholderProps = Omit<
  PlaceholderProps,
  "placement" | "fillParentHeight"
>;

/** Full-height placeholder whose position cannot drift from the detail body. */
export const DetailPanePlaceholder: React.FC<DetailPanePlaceholderProps> = memo(
  (props) => (
    <Placeholder {...props} placement="detail-panel" fillParentHeight />
  )
);

DetailPanePlaceholder.displayName = "DetailPanePlaceholder";

export default DetailPaneLayout;
