import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { syncDeepLinkAtom } from "@src/store/sync";

import type { StatusFilterType, WorkItemsViewTab } from "../types";

interface UseWorkItemsPageEffectsParams {
  statusFilter: StatusFilterType;
  setStatusFilter: (filter: StatusFilterType) => void;
  statusFilterKeys: readonly StatusFilterType[];
  resolvedSlug: string | undefined;
  onProjectSlugResolved?: (slug: string) => void;
  activeTab: WorkItemsViewTab;
  handleTabChange: (tab: WorkItemsViewTab) => void;
}

/**
 * Page-level subscriptions for the Work Items page: status-filter
 * normalization, resolved-slug reporting and the sync settings deep link.
 */
export function useWorkItemsPageEffects({
  statusFilter,
  setStatusFilter,
  statusFilterKeys,
  resolvedSlug,
  onProjectSlugResolved,
  activeTab,
  handleTabChange,
}: UseWorkItemsPageEffectsParams) {
  const deepLinkRequest = useAtomValue(syncDeepLinkAtom);
  const setDeepLinkRequest = useSetAtom(syncDeepLinkAtom);

  useEffect(() => {
    if (!statusFilterKeys.includes(statusFilter)) {
      setStatusFilter("all");
    }
  }, [setStatusFilter, statusFilter, statusFilterKeys]);

  // Persist resolved slug to tab data for faster loading on next app launch
  const reportedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (resolvedSlug && resolvedSlug !== reportedSlugRef.current) {
      reportedSlugRef.current = resolvedSlug;
      onProjectSlugResolved?.(resolvedSlug);
    }
  }, [resolvedSlug, onProjectSlugResolved]);

  // Deep-link consumer (Phase 4.8 Track D) — keep the request available until
  // the Settings view has rendered it once. Clearing it in the same effect as
  // the tab switch would remove the request before WorkItemsSettings mounts.
  const settingsSectionRequest =
    deepLinkRequest && resolvedSlug && deepLinkRequest.slug === resolvedSlug
      ? deepLinkRequest
      : undefined;
  useEffect(() => {
    if (!settingsSectionRequest) return;
    if (activeTab !== "Settings") {
      handleTabChange("Settings");
      return;
    }
    setDeepLinkRequest(null);
  }, [handleTabChange, setDeepLinkRequest, settingsSectionRequest, activeTab]);

  return { settingsSectionRequest };
}
