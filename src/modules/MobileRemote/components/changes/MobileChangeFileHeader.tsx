import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import { ArrowUpRight01Icon, HugeiconsIcon } from "@src/icons";

import type { ChangeFile } from "./useChangeReview";

export function MobileChangeFileHeader({
  file,
  expanded,
  full,
  onToggle,
  onOpenFull,
}: {
  file: ChangeFile;
  expanded: boolean;
  full: boolean;
  onToggle: () => void;
  onOpenFull: () => void;
}) {
  const { t } = useTranslation("mobileRemote");
  const path = file.path.replace(/\\/g, "/");
  const separator = path.lastIndexOf("/");
  return (
    <div className="mobile-change-review__file-heading">
      <Button
        layout="custom"
        className="mobile-change-review__file-toggle"
        disabled={full}
        aria-expanded={full ? undefined : expanded}
        aria-label={`${t(expanded ? "changeReview.collapse" : "changeReview.expand")} ${file.path}`}
        onClick={onToggle}
        title={file.path}
      >
        <span className="mobile-change-review__filename">
          {path.slice(separator + 1)}
        </span>
        {separator >= 0 && (
          <span className="mobile-change-review__directory">
            {path.slice(0, separator)}
          </span>
        )}
      </Button>
      {file.additions !== null && file.deletions !== null && (
        <DiffStatsBadge
          additions={file.additions}
          deletions={file.deletions}
          variant="plain"
          reserveValueWidth={false}
          gapClassName="gap-2"
        />
      )}
      {!full && (
        <Button
          iconOnly
          variant="tertiary"
          className="mobile-change-review__open-file"
          style={{
            width: "var(--mobile-change-touch-size)",
            height: "var(--mobile-change-touch-size)",
            padding: 0,
          }}
          aria-label={`${t("changeReview.full")}: ${file.path}`}
          onClick={onOpenFull}
          icon={
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={18}
              aria-hidden="true"
            />
          }
        />
      )}
    </div>
  );
}
