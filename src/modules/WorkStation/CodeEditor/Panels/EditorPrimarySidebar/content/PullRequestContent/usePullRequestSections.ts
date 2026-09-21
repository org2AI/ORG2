import type { TFunction } from "i18next";
import { useCallback, useMemo, useState } from "react";

import type { OpenPRItem } from "@src/api/tauri/github";
import type { SectionStatus } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionStatusRow";
import type { WorkstationOpenPrsLoadState } from "@src/store/workstation/codeEditor/workstationPrAtom";

import { filterPullRequestsByQuery } from "../../hooks/workstationPrHelpers";
import type { PrVirtualRow } from "./types";

function parsePrUrl(
  prUrl: string | undefined
): { repoFullName: string; number: number } | null {
  if (!prUrl) return null;
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repoFullName: m[1], number: Number(m[2]) };
}

interface UsePullRequestSectionsOptions {
  branchName?: string;
  filterQuery: string;
  prUrl: string | undefined;
  allOpenPrs: OpenPRItem[];
  allClosedPrs: OpenPRItem[];
  openPrsLoadState: WorkstationOpenPrsLoadState;
  openPrsError: string | null;
  closedPrsLoadState: WorkstationOpenPrsLoadState;
  closedPrsError: string | null;
  loadClosedPrs: ((force?: boolean) => void) | null;
  t: TFunction;
}

/**
 * The Open / Closed section model: collapse state, the filtered lists (the
 * current branch's PR first), per-section status rows, and the flattened
 * virtual row list.
 */
export function usePullRequestSections({
  branchName,
  filterQuery,
  prUrl,
  allOpenPrs,
  allClosedPrs,
  openPrsLoadState,
  openPrsError,
  closedPrsLoadState,
  closedPrsError,
  loadClosedPrs,
  t,
}: UsePullRequestSectionsOptions) {
  const [openCollapsed, setOpenCollapsed] = useState(false);
  const [closedCollapsed, setClosedCollapsed] = useState(true);

  const currentBranchPrFromList = useMemo(
    () =>
      branchName
        ? (allOpenPrs.find((p) => p.head_branch === branchName) ?? null)
        : null,
    [allOpenPrs, branchName]
  );

  const parsedAtomPr = useMemo(() => parsePrUrl(prUrl), [prUrl]);

  const orderedPrs = useMemo(() => {
    const sorted = currentBranchPrFromList
      ? [
          currentBranchPrFromList,
          ...allOpenPrs.filter(
            (p) => p.number !== currentBranchPrFromList.number
          ),
        ]
      : allOpenPrs;
    return filterPullRequestsByQuery(sorted, filterQuery);
  }, [allOpenPrs, currentBranchPrFromList, filterQuery]);

  const filteredClosedPrs = useMemo(
    () => filterPullRequestsByQuery(allClosedPrs, filterQuery),
    [allClosedPrs, filterQuery]
  );

  const handleToggleClosed = useCallback(() => {
    setClosedCollapsed((collapsed) => {
      if (collapsed && closedPrsLoadState === "idle") {
        loadClosedPrs?.();
      }
      return !collapsed;
    });
  }, [closedPrsLoadState, loadClosedPrs]);

  const hasCurrentBranchPr = !!currentBranchPrFromList || !!parsedAtomPr;

  const openStatus = useMemo<SectionStatus | null>(
    () =>
      openPrsLoadState === "loading" && orderedPrs.length === 0
        ? { kind: "loading", message: t("actions.loading", "Loading…") }
        : openPrsLoadState === "error" && orderedPrs.length === 0
          ? {
              kind: "error",
              message:
                openPrsError ??
                t("git.pr.failedToLoad", "Failed to load pull requests"),
            }
          : orderedPrs.length === 0
            ? {
                kind: "empty",
                message: t("labels.noPullRequest", "No pull request"),
              }
            : null,
    [openPrsError, openPrsLoadState, orderedPrs.length, t]
  );

  const closedStatus = useMemo<SectionStatus | null>(
    () =>
      closedPrsLoadState === "loading" && filteredClosedPrs.length === 0
        ? { kind: "loading", message: t("actions.loading", "Loading…") }
        : closedPrsLoadState === "error" && filteredClosedPrs.length === 0
          ? {
              kind: "error",
              message:
                closedPrsError ??
                t("git.pr.failedToLoad", "Failed to load pull requests"),
            }
          : closedPrsLoadState === "ready" && filteredClosedPrs.length === 0
            ? {
                kind: "empty",
                message: t("labels.noPullRequest", "No pull request"),
              }
            : null,
    [closedPrsError, closedPrsLoadState, filteredClosedPrs.length, t]
  );

  // When the Open section is the sidebar's only content (Closed collapsed) and
  // it has no rows, render its loading/empty state as a centered Explorer-style
  // Placeholder that fills the pane instead of a compact inline row. Error
  // states and per-section states keep the inline SectionStatusRow so each
  // section retains its own structured state.
  const openWholePane = closedCollapsed && orderedPrs.length === 0;

  // Virtualized row model — headers, per-section status, and PR rows flattened
  // into one windowed list (same pattern as IssuesContent). Collapsed sections
  // contribute only their header, so their rows are never built or mounted.
  const virtualRows = useMemo<PrVirtualRow[]>(() => {
    const rows: PrVirtualRow[] = [{ kind: "header", section: "open" }];
    if (!openCollapsed) {
      if (openStatus) {
        rows.push({ kind: "status", section: "open", status: openStatus });
      } else {
        rows.push(...orderedPrs.map((pr) => ({ kind: "pr" as const, pr })));
      }
    }
    rows.push({ kind: "header", section: "closed" });
    if (!closedCollapsed) {
      if (closedStatus) {
        rows.push({ kind: "status", section: "closed", status: closedStatus });
      } else {
        rows.push(
          ...filteredClosedPrs.map((pr) => ({ kind: "pr" as const, pr }))
        );
      }
    }
    return rows;
  }, [
    closedCollapsed,
    closedStatus,
    filteredClosedPrs,
    openCollapsed,
    openStatus,
    orderedPrs,
  ]);

  return {
    openCollapsed,
    setOpenCollapsed,
    closedCollapsed,
    orderedPrs,
    filteredClosedPrs,
    handleToggleClosed,
    hasCurrentBranchPr,
    openStatus,
    openWholePane,
    virtualRows,
  };
}
