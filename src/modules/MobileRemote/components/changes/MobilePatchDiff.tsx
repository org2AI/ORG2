import React, { Suspense, lazy, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import { ArrowDown01Icon, HugeiconsIcon } from "@src/icons";

import { MobileChangeReviewState } from "./MobileChangeReviewState";
import { parseReviewPatch } from "./parseReviewPatch";

const Editor = lazy(() => import("../transcript/MobileReadonlyEditor"));
const PAGE_LINES = 80;

export const MobilePatchDiff = memo(function MobilePatchDiff({
  patches,
  filePath,
  wrap,
}: {
  patches: string[];
  filePath: string;
  wrap: boolean;
}) {
  const { t } = useTranslation("mobileRemote");
  const parsed = useMemo(() => patches.map(parseReviewPatch), [patches]);
  const [limit, setLimit] = useState(PAGE_LINES);
  // Unknown formats are readable, never silently discarded as an empty diff.
  if (parsed.some((hunks) => hunks === null))
    return (
      <>
        <p className="mobile-patch-diff__notice">
          {t("changeReview.rawPatch")}
        </p>
        <Suspense
          fallback={<MobileChangeReviewState state="loading" compact />}
        >
          <Editor
            content={patches.join("\n")}
            filePath={filePath}
            language="diff"
            wrap={wrap}
            height="auto"
          />
        </Suspense>
      </>
    );
  const visible = [];
  let offset = 0;
  for (const [patchIndex, hunks] of parsed.entries()) {
    for (const [hunkIndex, hunk] of hunks!.entries()) {
      const lines = hunk.lines.slice(0, Math.max(0, limit - offset));
      offset += hunk.lines.length;
      if (lines.length) visible.push({ patchIndex, hunkIndex, hunk, lines });
    }
  }
  const total = parsed.reduce(
    (count, hunks) =>
      count + hunks!.reduce((sum, hunk) => sum + hunk.lines.length, 0),
    0
  );
  return (
    <div className={`mobile-patch-diff ${wrap ? "is-wrapped" : ""}`}>
      {visible.map(({ patchIndex, hunkIndex, hunk, lines }) => {
        const start = hunk.newCount ? hunk.newStart : hunk.oldStart;
        const count = hunk.newCount || hunk.oldCount;
        return (
          <details
            key={`${patchIndex}:${hunkIndex}`}
            open
            className="mobile-patch-diff__hunk"
          >
            <summary>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={16}
                aria-hidden="true"
              />
              <span>
                {patches.length > 1 &&
                  `${t("changeReview.edit", { count: patchIndex + 1 })} · `}
                {t("changeReview.lines", { start, end: start + count - 1 })}
              </span>
              <DiffStatsBadge
                additions={hunk.additions}
                deletions={hunk.deletions}
                variant="plain"
                reserveValueWidth={false}
                gapClassName="gap-2"
              />
            </summary>
            <div
              className="mobile-patch-diff__code"
              role="region"
              aria-label={`${filePath}: ${start}`}
              tabIndex={0}
            >
              {lines.map((line, index) => (
                <div
                  key={index}
                  className={`mobile-patch-diff__line is-${line.kind}`}
                >
                  <span
                    className="mobile-patch-diff__number"
                    aria-hidden="true"
                  >
                    {line.newLine ?? line.oldLine}
                  </span>
                  <span className="mobile-patch-diff__sign">
                    {line.kind === "added"
                      ? "+"
                      : line.kind === "deleted"
                        ? "−"
                        : " "}
                  </span>
                  <code>
                    {line.text || " "}
                    {line.noNewline && (
                      <span className="mobile-patch-diff__newline">
                        {" "}
                        {t("changeReview.noNewline")}
                      </span>
                    )}
                  </code>
                </div>
              ))}
            </div>
          </details>
        );
      })}
      {total > limit && (
        <Button
          variant="tertiary"
          className="mobile-patch-diff__more"
          onClick={() => setLimit((value) => value + PAGE_LINES)}
        >
          {t("changeReview.showMoreLines", {
            count: Math.min(PAGE_LINES, total - limit),
          })}
        </Button>
      )}
    </div>
  );
});
