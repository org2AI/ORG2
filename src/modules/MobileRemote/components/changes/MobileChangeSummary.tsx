import React, { useId } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import SkeletonBar from "@src/components/Skeleton";
import { ArrowDown01Icon, HugeiconsIcon, Refresh04Icon } from "@src/icons";
import {
  getCompactPathLabel,
  getDirectory,
  getFileName,
  getPathSegments,
} from "@src/util/file/pathUtils";

import type { ChangeFile } from "./useChangeReview";

interface Props {
  files: readonly ChangeFile[] | undefined;
  online: boolean;
  error: boolean;
  refreshing?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (path?: string) => void;
  onRetry: () => void;
}

// Button owns inline geometry. Keep the mobile card's dimensions at that
// boundary too, with values owned by the scoped stylesheet.
const rowStyle: React.CSSProperties = {
  height: "auto",
  minHeight: "var(--mobile-change-row-height)",
  padding: "var(--mobile-change-row-padding)",
  borderRadius: 0,
  fontSize: "inherit",
};

function Stats({
  additions,
  deletions,
}: Pick<ChangeFile, "additions" | "deletions">) {
  return (
    <span className="mobile-change-review__stats">
      {additions !== null && deletions !== null ? (
        <DiffStatsBadge
          additions={additions}
          deletions={deletions}
          variant="plain"
          reserveValueWidth={false}
          gapClassName="gap-2"
        />
      ) : (
        <span className="mobile-change-review__unknown">—</span>
      )}
    </span>
  );
}

function FilePath({ path }: { path: string }) {
  const directory = getDirectory(path);
  const compactDirectory = getCompactPathLabel(directory, 2);
  const directoryLabel =
    getPathSegments(directory).length > 2
      ? `…/${compactDirectory}`
      : compactDirectory;

  return (
    <span className="mobile-change-review__path" title={path}>
      <span className="mobile-change-review__path-filename">
        {getFileName(path)}
      </span>
      {directoryLabel && (
        <span className="mobile-change-review__path-directory">
          {directoryLabel}
        </span>
      )}
    </span>
  );
}

/** A presentation-only card; the parent owns the manifest, retry and viewer. */
export function MobileChangeSummary({
  files,
  online,
  error,
  refreshing = false,
  expanded,
  onToggle,
  onOpen,
  onRetry,
}: Props) {
  const { t } = useTranslation("mobileRemote");
  const rowsId = useId();
  const ready = !!files?.length;
  const loading = online && !error && !files;
  const total = (key: "additions" | "deletions") =>
    files?.every((file) => file[key] !== null)
      ? files.reduce((sum, file) => sum + file[key]!, 0)
      : null;
  const heading = (
    <span className="mobile-change-review__heading-content">
      <span className="mobile-change-review__label">
        {ready
          ? t("changeReview.filesCount", { count: files.length })
          : t("changeReview.title")}
      </span>
      {ready && (
        <Stats additions={total("additions")} deletions={total("deletions")} />
      )}
    </span>
  );

  return (
    <section
      className="mobile-change-review"
      aria-label={t("changeReview.title")}
      aria-busy={loading || refreshing}
    >
      <div className="mobile-change-review__summary">
        <Button
          long
          variant="tertiary"
          className="mobile-change-review__heading"
          style={rowStyle}
          aria-haspopup="dialog"
          onClick={() => onOpen()}
        >
          {heading}
        </Button>
        {ready && (
          <Button
            iconOnly
            variant="tertiary"
            className="mobile-change-review__toggle"
            style={{
              width: "var(--mobile-change-touch-size)",
              height: "var(--mobile-change-row-height)",
              padding: 0,
              borderRadius: 0,
            }}
            aria-label={t(
              expanded ? "changeReview.collapse" : "changeReview.expand"
            )}
            aria-expanded={expanded}
            aria-controls={rowsId}
            onClick={onToggle}
            icon={
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={18}
                aria-hidden="true"
                className={
                  expanded
                    ? "mobile-change-review__chevron is-expanded"
                    : "mobile-change-review__chevron"
                }
              />
            }
          />
        )}
      </div>
      {!online || error || refreshing ? (
        <div className="mobile-change-review__status">
          <p role="status" className="mobile-change-review__status-copy">
            {t(
              !online
                ? "changeReview.offline"
                : error
                  ? files
                    ? "changeReview.refreshFailed"
                    : "changeReview.loadFailed"
                  : "changeReview.refreshing"
            )}
          </p>
          {online && error && (
            <Button
              variant="tertiary"
              className="mobile-change-review__retry"
              style={{
                height: "var(--mobile-change-touch-size)",
                padding: "0 var(--mobile-change-action-padding)",
                borderRadius: "var(--mobile-change-action-radius)",
                fontSize: "inherit",
              }}
              icon={
                <HugeiconsIcon
                  icon={Refresh04Icon}
                  size={16}
                  aria-hidden="true"
                />
              }
              onClick={onRetry}
            >
              {t("changeReview.retry")}
            </Button>
          )}
        </div>
      ) : loading ? (
        <div className="mobile-change-review__loading" role="status">
          <span className="sr-only">{t("changeReview.loading")}</span>
          <div className="mobile-change-review__loading-row" aria-hidden="true">
            <SkeletonBar className="h-3 w-3/5" />
            <SkeletonBar className="h-3 w-12" />
          </div>
          <div className="mobile-change-review__loading-row" aria-hidden="true">
            <SkeletonBar className="h-3 w-2/5" />
            <SkeletonBar className="h-3 w-12" />
          </div>
        </div>
      ) : null}
      <div id={rowsId} hidden={!expanded}>
        {expanded &&
          files?.map((file) => (
            <Button
              key={file.path}
              long
              variant="tertiary"
              className="mobile-change-review__row"
              style={rowStyle}
              data-mobile-change-path={file.path}
              onClick={() => onOpen(file.path)}
            >
              <span className="mobile-change-review__row-content">
                <FilePath path={file.path} />
                <Stats additions={file.additions} deletions={file.deletions} />
              </span>
            </Button>
          ))}
      </div>
    </section>
  );
}
