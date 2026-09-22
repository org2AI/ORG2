import React from "react";
import { useTranslation } from "react-i18next";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { ArrowDown01Icon, HugeiconsIcon } from "@src/icons";
import { getPathSegments } from "@src/util/file/pathUtils";

import type { MobileFileTarget } from "./mobileFileTool";

/** Presentation only: never shorten the path used for remote file operations. */
export function MobileFileIdentity({ target }: { target: MobileFileTarget }) {
  const { t } = useTranslation("mobileRemote");
  const directories = getPathSegments(target.filePath).slice(0, -1);
  const directory =
    directories.length > 2
      ? `… / ${directories.slice(-2).join(" / ")}`
      : directories.join(" / ");

  return (
    <details
      key={target.filePath}
      className="mobile-file-identity group min-w-0 flex-1"
    >
      <summary
        tabIndex={0}
        className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
        aria-label={`${target.fileName} · ${t("fileViewer.fileLocation")}`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fill-2"
          aria-hidden="true"
        >
          <FileTypeIcon fileName={target.fileName} size="large" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="mobile-type-secondary block truncate font-semibold text-text-1"
            title={target.fileName}
          >
            {target.fileName}
          </span>
          <span className="mobile-type-caption mt-0.5 flex min-w-0 items-center gap-1 font-normal text-text-3">
            <span className="truncate" data-mobile-file-directory="">
              {directory || t("fileViewer.fileLocation")}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 group-open:rotate-180"
            />
          </span>
        </span>
      </summary>
      <div
        className="mobile-type-caption mt-2 max-h-32 overflow-auto rounded-lg bg-fill-1 px-3 py-2 font-normal break-all text-text-2 select-text"
        data-mobile-file-full-path=""
      >
        {target.filePath}
      </div>
    </details>
  );
}
