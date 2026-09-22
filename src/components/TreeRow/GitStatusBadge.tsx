/**
 * Git Status Badge Component
 *
 * Shared component for displaying git status indicators.
 * - Directories: Show colored dot
 * - Files: Show status letter (M, A, D, R, U)
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Tooltip from "@src/components/Tooltip";
import {
  getStatusBgColor,
  getStatusColorForFile,
  getStatusLetterForFile,
} from "@src/config/gitStatus";

import type { GitStatusBadgeProps } from "./types";

export const GitStatusBadge: React.FC<GitStatusBadgeProps> = React.memo(
  ({ status, isDirectory, title }) => {
    const { t } = useTranslation();
    if (!status) {
      return null;
    }

    const statusLetter = getStatusLetterForFile(status.status, status.staged);
    const colorClass = getStatusColorForFile(status.status, status.staged);
    const statusLabel = t(`common:gitLabels.${statusLetter}`);
    const tooltipLabel =
      title ??
      (isDirectory
        ? t("common:gitLabels.contains", { status: statusLabel })
        : status.staged
          ? t("common:gitLabels.staged", { status: statusLabel })
          : statusLabel);

    return (
      <Tooltip content={tooltipLabel} mouseEnterDelay={500}>
        <div className="flex h-4 w-5 shrink-0 items-center justify-center">
          {isDirectory ? (
            <div
              className={`h-1.5 w-1.5 rounded-full ${getStatusBgColor(status.status)}`}
            />
          ) : (
            <span className={`text-[12px] font-medium ${colorClass}`}>
              {statusLetter}
            </span>
          )}
        </div>
      </Tooltip>
    );
  }
);

GitStatusBadge.displayName = "GitStatusBadge";

export default GitStatusBadge;
