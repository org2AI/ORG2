import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import SkeletonBar from "@src/components/Skeleton";
import {
  AlertCircleIcon,
  FileSearchIcon,
  HugeiconsIcon,
  Plug01Icon,
  Refresh04Icon,
} from "@src/icons";
import { classNames } from "@src/util/ui/classNames";

import "./mobileChangeReviewState.scss";

interface Props {
  state:
    | "loading"
    | "refreshing"
    | "refresh-error"
    | "error"
    | "offline"
    | "empty"
    | "unavailable";
  onRetry?: () => void;
  compact?: boolean;
}

const messages = {
  loading: "changeReview.loading",
  error: "changeReview.loadFailed",
  refreshing: "changeReview.refreshing",
  "refresh-error": "changeReview.refreshFailed",
  offline: "changeReview.offline",
  empty: "changeReview.empty",
  unavailable: "changeReview.unavailable",
} as const;

/** Presentation only: request identity, cancellation and retry stay in the hook. */
export function MobileChangeReviewState({
  state,
  onRetry,
  compact = false,
}: Props) {
  const { t } = useTranslation("mobileRemote");
  const loading = state === "loading";
  return (
    <div
      className={classNames(
        "mobile-change-state",
        compact && "mobile-change-state--compact"
      )}
      data-state={state}
      role="status"
      aria-busy={loading || state === "refreshing"}
    >
      {loading ? (
        <>
          <span className="sr-only">{t(messages.loading)}</span>
          <div className="mobile-change-state__skeleton" aria-hidden="true">
            <SkeletonBar className="h-3 w-2/5" />
            <SkeletonBar className="h-3 w-4/5" />
            <SkeletonBar className="h-3 w-3/5" />
          </div>
        </>
      ) : (
        <>
          <span className="mobile-change-state__symbol" aria-hidden="true">
            <HugeiconsIcon
              icon={
                state === "error" || state === "refresh-error"
                  ? AlertCircleIcon
                  : state === "refreshing"
                    ? Refresh04Icon
                    : state === "offline"
                      ? Plug01Icon
                      : FileSearchIcon
              }
              size={20}
            />
          </span>
          <p className="mobile-change-state__message">{t(messages[state])}</p>
          {(state === "error" || state === "refresh-error") && onRetry && (
            <Button
              variant="tertiary"
              className="mobile-change-state__retry"
              style={{
                height: "var(--mobile-change-state-touch)",
                padding: "0 var(--mobile-change-state-space)",
                borderRadius: "var(--mobile-change-state-radius)",
                fontSize: "inherit",
              }}
              icon={
                <HugeiconsIcon icon={Refresh04Icon} size={16} aria-hidden />
              }
              onClick={onRetry}
            >
              {t("changeReview.retry")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
