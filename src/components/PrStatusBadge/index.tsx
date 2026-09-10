import type { ReactNode } from "react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import Tag from "@src/components/Tag";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  HugeiconsIcon,
} from "@src/icons";
import {
  type PrStatusIconName,
  getPrStatusIconName,
  getPrStatusLabelKey,
  getPrStatusVariant,
} from "@src/shared/pr/prStatus";
import { classNames } from "@src/util/ui/classNames";

interface PrStatusBadgeProps {
  status: string;
  label?: ReactNode;
  showIcon?: boolean;
  showDot?: boolean;
  size?: "xs" | "sm";
  className?: string;
  pill?: boolean;
  iconSize?: number;
}

const SIZE_CLASSES = {
  xs: "rounded px-1.5 py-0.5 text-[10px]",
  sm: "rounded-full px-2 py-0.5 text-[11px]",
} as const;

function StatusIcon({ name, size }: { name: PrStatusIconName; size: number }) {
  switch (name) {
    case "merge":
      return (
        <HugeiconsIcon icon={GitMergeIcon} data-icon="git-merge" size={size} />
      );
    case "closed":
      return (
        <HugeiconsIcon
          icon={GitPullRequestClosedIcon}
          data-icon="git-pull-request-closed"
          size={size}
        />
      );
    case "draft":
      return (
        <HugeiconsIcon
          icon={GitPullRequestDraftIcon}
          data-icon="git-pull-request-draft"
          size={size}
        />
      );
    case "pull-request":
    default:
      return (
        <HugeiconsIcon
          icon={GitPullRequestIcon}
          data-icon="git-pull-request"
          size={size}
        />
      );
  }
}

const PrStatusBadge = memo<PrStatusBadgeProps>(
  ({
    status,
    label,
    showIcon = false,
    showDot = false,
    size = "xs",
    className,
    pill = false,
    iconSize = 10,
  }) => {
    const { t } = useTranslation("common");
    const variant = getPrStatusVariant(status);
    const iconName = getPrStatusIconName(status);
    const badgeLabel =
      label ?? t(getPrStatusLabelKey(status), status || "unknown");

    if (pill) {
      return (
        <Tag
          pill
          size={size === "xs" ? "mini" : "small"}
          className={className}
          color={
            status === "open"
              ? "success"
              : status === "closed"
                ? "danger"
                : "default"
          }
          style={
            status === "merged"
              ? {
                  backgroundColor: "var(--color-purple-1)",
                  color: "var(--color-purple-6)",
                }
              : undefined
          }
          icon={
            showIcon ? (
              <StatusIcon name={iconName} size={iconSize} />
            ) : undefined
          }
        >
          {showDot && (
            <span
              className={classNames(
                "inline-block size-1.5 rounded-full",
                variant.dotClass
              )}
              aria-hidden
            />
          )}
          {badgeLabel}
        </Tag>
      );
    }

    return (
      <span
        className={classNames(
          "inline-flex shrink-0 items-center gap-1 font-medium capitalize",
          SIZE_CLASSES[size],
          variant.badgeClass,
          className
        )}
      >
        {showIcon && <StatusIcon name={iconName} size={iconSize} />}
        {showDot && (
          <span
            className={classNames("h-1.5 w-1.5 rounded-full", variant.dotClass)}
            aria-hidden
          />
        )}
        {badgeLabel}
      </span>
    );
  }
);

PrStatusBadge.displayName = "PrStatusBadge";

export default PrStatusBadge;
