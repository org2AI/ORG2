import DiffStatsBadge from "@src/components/DiffStatsBadge";
import { useWorkingTreeDiffTotals } from "@src/hooks/git/useWorkingTreeDiffTotals";

import type { FocusedChatRailItem } from "./types";

/** Visible folded repository summaries share the same numstat store as rows. */
export function WorkstationCollapsedDiffStats({
  item,
}: {
  item: FocusedChatRailItem;
}) {
  const totals = useWorkingTreeDiffTotals(
    item.workingTreeRepo?.repoId,
    item.workingTreeRepo?.repoPath
  );
  return (
    <DiffStatsBadge
      additions={totals.additions}
      deletions={totals.deletions}
      variant="plain"
      size="sm"
      reserveValueWidth={false}
      valueClassName="font-normal"
      className="ml-1 shrink-0"
    />
  );
}
