/**
 * PageNotice — Shared notice/result card for page and panel content.
 *
 * Single neutral treatment for every type: a 1px `border-border-1` outline, the
 * Workstation-trail radius and a half-strength dropdown shadow, with no
 * background fill so alerts don't compete with sections that already have their
 * own surface color.
 * There is deliberately no danger / warning / success color variant — `type`
 * only selects the leading icon.
 *
 * Padding (p-3, or py-1 pl-3 pr-1 when compact), icon size 14.
 * Header row: icon + title + optional action + close;
 * body (children) and subtitle render below the header.
 * When action is an object, PageNotice builds a secondary Button at 28px height.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import {
  Cancel01Icon,
  ChevronsDownUpIcon,
  Copy01Icon,
  HugeiconsIcon,
  InformationCircleIcon,
  Tick01Icon,
  TriangleAlertIcon,
  UnfoldMoreIcon,
} from "@src/icons";
import { copyText } from "@src/util/data/clipboard";

import "./index.css";

/**
 * Shared neutral surface — flat outline, no tone accent, and a half-strength
 * Workstation-trail shadow for a little lift.
 */
const ALERT_SURFACE_CLASS = `border border-solid border-border-1 text-text-1 ${DROPDOWN_PANEL.shadowSoftClass}`;

/** Matches the Workstation trail surface radius. Collapsed pills stay round. */
const ALERT_RADIUS_CLASS = "rounded-xl";

const DEFAULT_ICONS: Record<string, React.ReactNode> = {
  success: (
    <HugeiconsIcon
      icon={Tick01Icon}
      data-icon="check"
      size={14}
      className="shrink-0"
    />
  ),
  danger: (
    <HugeiconsIcon
      icon={TriangleAlertIcon}
      data-icon="triangle-alert"
      size={14}
      className="shrink-0"
    />
  ),
  warning: (
    <HugeiconsIcon
      icon={TriangleAlertIcon}
      data-icon="triangle-alert"
      size={14}
      className="shrink-0"
    />
  ),
  info: (
    <HugeiconsIcon
      icon={InformationCircleIcon}
      data-icon="info"
      size={14}
      className="shrink-0"
    />
  ),
};

/**
 * Alert copy is content, not chrome — opt back in to text selection over the
 * global `* { user-select: none }` so users can select/copy titles, bodies and
 * technical details. Interactive children opt out again with `select-none`.
 */
const SELECTABLE_TEXT_CLASS = "allow-select-deep page-notice__text";

interface PageNoticeActionConfig {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

function isActionConfig(
  action: PageNoticeActionConfig | React.ReactNode
): action is PageNoticeActionConfig {
  return (
    typeof action === "object" &&
    action !== null &&
    "label" in action &&
    typeof (action as unknown as Record<string, unknown>).label === "string"
  );
}

interface PageNoticeProps {
  /**
   * Selects the default leading icon only — all types share one neutral style.
   * Defaults to "info".
   */
  type?: "success" | "danger" | "warning" | "info";
  /** Body text (below the header row) */
  children?: React.ReactNode;
  /** Title in the header row (same row as icon, action, close) */
  title?: string;
  /** Optional icon override — defaults to Check/TriangleAlert/AlertCircle/Info per type */
  icon?: React.ReactNode;
  /** Hide the icon entirely */
  hideIcon?: boolean;
  /** Optional subtitle below the body */
  subtitle?: React.ReactNode;
  /** Override title typography; block layout, weight and selection are preserved. */
  titleClassName?: string;
  /** Override body typography; weight and selection are preserved. */
  bodyClassName?: string;
  /** Override subtitle typography; layout, opacity and selection are preserved. */
  subtitleClassName?: string;
  /** Extra className on the outer container */
  className?: string;
  /** Reduce default-card vertical and right padding without shrinking action buttons. */
  compact?: boolean;
  /** Show the copy action. Disable for transient status guidance without useful copyable details. */
  copyable?: boolean;
  /** Compact expandable pill that shows only title until expanded */
  presentation?: "default" | "pill";
  /** Optional action — object builds a 28px secondary Button; ReactNode for custom */
  action?: PageNoticeActionConfig | React.ReactNode;
  /** Show a close icon button when provided */
  onClose?: () => void;
  /** Optional close icon override */
  closeIcon?: React.ReactNode;
  /** Accessible label for close button */
  closeAriaLabel?: string;
  /** Automatically invoke onClose after this delay. Requires onClose. */
  autoCloseMs?: number;
  /** Accessible landmark/live-region role for the alert container. */
  role?: React.AriaRole;
  /** Stable test hook for the alert container. */
  dataTestId?: string;
}

const PageNotice: React.FC<PageNoticeProps> = ({
  type = "info",
  children,
  title,
  icon,
  hideIcon = false,
  subtitle,
  titleClassName,
  bodyClassName,
  subtitleClassName,
  className,
  compact = false,
  copyable = true,
  presentation = "default",
  action,
  onClose,
  closeIcon,
  closeAriaLabel = "Close",
  autoCloseMs,
  role,
  dataTestId,
}) => {
  const { t } = useTranslation("common");
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const subtitleRef = React.useRef<HTMLSpanElement>(null);
  const handleCopy = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = [
      title,
      bodyRef.current?.innerText ?? bodyRef.current?.textContent,
      subtitleRef.current?.innerText ?? subtitleRef.current?.textContent,
    ]
      .filter((part) => part?.trim())
      .join("\n\n");
    if (!text) return;
    copyText(text).then(
      () => Message.success(t("status.copied")),
      () => Message.error(t("status.copyFailed"))
    );
  };
  const baseText = {
    title: `block font-medium ${titleClassName ?? "text-[13px] leading-[14px]"}`,
    body: `font-normal ${bodyClassName ?? "text-[12px] leading-snug"}`,
    subtitle: `mt-1 block opacity-70 ${subtitleClassName ?? "text-[11px]"}`,
  };
  const textClasses = {
    title: `${baseText.title} ${SELECTABLE_TEXT_CLASS}`,
    body: `${baseText.body} ${SELECTABLE_TEXT_CLASS}`,
    subtitle: `${baseText.subtitle} ${SELECTABLE_TEXT_CLASS}`,
  };
  const [expanded, setExpanded] = React.useState(presentation !== "pill");
  const isPill = presentation === "pill";
  const cardPaddingClass = compact ? "py-1 pl-3 pr-1" : "p-3";
  const showContent = !isPill || expanded;
  const resolvedIcon =
    icon ??
    (isPill ? (
      expanded ? (
        <HugeiconsIcon
          icon={ChevronsDownUpIcon}
          data-icon="chevrons-down-up"
          size={14}
          className="shrink-0"
        />
      ) : (
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          data-icon="chevrons-up-down"
          size={14}
          className="shrink-0"
        />
      )
    ) : (
      DEFAULT_ICONS[type]
    ));
  const resolvedCloseIcon = closeIcon ?? (
    <HugeiconsIcon
      icon={Cancel01Icon}
      data-icon="x"
      size={14}
      className="shrink-0"
    />
  );
  const hasTitle = Boolean(title);

  React.useEffect(() => {
    if (!onClose || !autoCloseMs || autoCloseMs <= 0) return;
    const timeout = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(timeout);
  }, [autoCloseMs, onClose]);

  const actionNode =
    action &&
    (isActionConfig(action) ? (
      <Button
        size="small"
        href={action.href}
        target={action.href ? "_blank" : undefined}
        rel={action.href ? "noopener noreferrer" : undefined}
        onClick={action.onClick}
        disabled={action.disabled}
        icon={action.icon}
        iconPosition={action.iconPosition}
      >
        {action.label}
      </Button>
    ) : (
      (action as React.ReactNode)
    ));

  const titleNode = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {!hideIcon && (
        <span className="flex h-[14px] shrink-0 items-center">
          {resolvedIcon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {hasTitle ? (
          // Pill headers double as the expand/collapse hit area — keep their
          // text non-selectable so a drag doesn't fight the toggle.
          <span className={isPill ? baseText.title : textClasses.title}>
            {title}
          </span>
        ) : (
          showContent &&
          children && (
            <div
              ref={bodyRef}
              className={`block ${isPill ? baseText.body : textClasses.body}`}
            >
              {children}
            </div>
          )
        )}
      </div>
    </div>
  );

  return (
    <div
      role={role}
      data-testid={dataTestId}
      className={`page-notice ${ALERT_SURFACE_CLASS} ${isPill ? `inline-block w-fit max-w-full ${expanded ? ALERT_RADIUS_CLASS : "rounded-full"} px-3 py-2` : `${ALERT_RADIUS_CLASS} ${cardPaddingClass}`} ${className ?? ""}`}
    >
      <div className={`flex items-center ${isPill ? "gap-1" : "gap-3"}`}>
        {isPill ? (
          <Button
            layout="custom"
            onClick={() => setExpanded((currentExpanded) => !currentExpanded)}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center text-left"
          >
            {titleNode}
          </Button>
        ) : (
          titleNode
        )}
        {((copyable && (title || children || subtitle)) ||
          action ||
          onClose) && (
          <div className="flex shrink-0 items-center gap-px">
            {copyable && (
              <Button
                variant="tertiary"
                size="small"
                iconOnly
                icon={<HugeiconsIcon icon={Copy01Icon} size={14} />}
                title={t("actions.copy")}
                aria-label={t("actions.copy")}
                onClick={handleCopy}
              />
            )}
            {action && <div className="shrink-0">{actionNode}</div>}
            {onClose && (
              <Button
                variant="tertiary"
                size="small"
                icon={resolvedCloseIcon}
                iconOnly
                title={closeAriaLabel}
                aria-label={closeAriaLabel}
                onClick={onClose}
              />
            )}
          </div>
        )}
      </div>
      {showContent && hasTitle && children && (
        <div ref={bodyRef} className={`mt-2 ${textClasses.body}`}>
          {children}
        </div>
      )}
      {showContent && subtitle && (
        <span ref={subtitleRef} className={textClasses.subtitle}>
          {subtitle}
        </span>
      )}
    </div>
  );
};

export default PageNotice;
