import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import { HugeiconsIcon, InformationCircleIcon } from "@src/icons";

export function TeamInboxPullRequestsNotice({
  error,
  detailed,
  onToggleDetails,
  onDismiss,
}: {
  error: string;
  detailed: boolean;
  onToggleDetails: () => void;
  onDismiss: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <PageNotice
      type="warning"
      className="mx-3 mb-2"
      title={t("teamInbox.errors.pullRequestsPartialLoad")}
      action={
        <Button
          variant="tertiary"
          size="small"
          icon={
            <HugeiconsIcon
              icon={InformationCircleIcon}
              data-icon="info"
              size={14}
              strokeWidth={1.8}
            />
          }
          iconOnly
          className="h-7 w-7"
          aria-label={t("common:common.details")}
          title={t("common:common.details")}
          data-testid="team-inbox-partial-load-info"
          onClick={onToggleDetails}
        />
      }
      onClose={onDismiss}
      closeAriaLabel={t("common:actions.close")}
    >
      {detailed ? (
        <div className="space-y-1 text-text-2">
          <div>{t("teamInbox.errors.pullRequestsPartialLoadHelp")}</div>
          <div className="text-[11px] wrap-break-word text-text-3">{error}</div>
        </div>
      ) : null}
    </PageNotice>
  );
}
