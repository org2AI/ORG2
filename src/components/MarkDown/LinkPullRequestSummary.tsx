import { useTranslation } from "react-i18next";

import Avatar from "@src/components/Avatar";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import PrStatusBadge from "@src/components/PrStatusBadge";
import SkeletonBar from "@src/components/Skeleton";
import type { GitHubPrDetailTabData } from "@src/types/githubDetail";
import type { GitHubPullRequestRef } from "@src/util/git/githubPullRequestUrl";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

interface Props {
  pullRequest: GitHubPullRequestRef;
  data: GitHubPrDetailTabData | null;
  author: { login?: string; avatarUrl?: string } | null;
  filesChanged?: number;
  loading: boolean;
}

/** Skeletons reserve the same line boxes as the loaded summary. */
export default function LinkPullRequestSummary({
  pullRequest,
  data,
  author,
  filesChanged,
  loading,
}: Props) {
  const { t, i18n } = useTranslation("sessions");
  return (
    <div className="space-y-2" aria-busy={loading}>
      <div className="flex h-6 items-center gap-1.5 text-xs text-text-3">
        {loading ? (
          <SkeletonBar className="h-6 w-16 rounded-full" />
        ) : (
          <PrStatusBadge
            status={data?.prStatus ?? "unknown"}
            showIcon
            pill
            size="xs"
            iconSize={14}
          />
        )}
        <span
          className="min-w-0 flex-1 truncate"
          title={`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
        >
          {pullRequest.owner}/{pullRequest.repo} #{pullRequest.number}
        </span>
        {loading ? (
          <SkeletonBar className="h-3 w-10" />
        ) : (
          data?.updatedAt && (
            <span className="shrink-0" title={data.updatedAt}>
              {formatRelativeTime(data.updatedAt, "compact", i18n.language)}
            </span>
          )
        )}
      </div>
      <div className="text-sm leading-5 font-medium text-text-1">
        {loading ? (
          <div className="space-y-0" aria-hidden>
            <div className="flex h-5 items-center">
              <SkeletonBar className="h-3.5 w-full" />
            </div>
            <div className="flex h-5 items-center">
              <SkeletonBar className="h-3.5 w-2/3" />
            </div>
          </div>
        ) : (
          <div className="break-words">
            {data?.prTitle ?? `PR #${pullRequest.number}`}
          </div>
        )}
      </div>
      <div className="flex h-6 items-center gap-1.5 text-xs text-text-3">
        {loading ? (
          <>
            <SkeletonBar className="size-5 shrink-0 rounded-full" />
            <SkeletonBar className="h-3 w-20" />
            <SkeletonBar className="ml-auto h-3 w-16" />
            <SkeletonBar className="h-3 w-12" />
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {author?.login && (
                <>
                  <Avatar size={20} src={author.avatarUrl} hideOnError />
                  <span className="truncate" title={author.login}>
                    {author.login}
                  </span>
                </>
              )}
            </div>
            {filesChanged != null && (
              <span className="shrink-0">
                {t("cards.url.changesCount", { count: filesChanged })}
              </span>
            )}
            {filesChanged != null &&
              (data?.additions != null || data?.deletions != null) && (
                <span aria-hidden className="text-text-4">
                  ·
                </span>
              )}
            {(data?.additions != null || data?.deletions != null) && (
              <DiffStatsBadge
                variant="plain"
                additions={data?.additions ?? undefined}
                deletions={data?.deletions ?? undefined}
                showAdditions={data?.additions != null}
                showDeletions={data?.deletions != null}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
