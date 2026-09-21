import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import Dropdown from "@src/components/Dropdown";
import DropdownCollapsibleSectionHeader from "@src/components/Dropdown/DropdownCollapsibleSectionHeader";
import DropdownFooter from "@src/components/Dropdown/DropdownFooter";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import DropdownPanel from "@src/components/Dropdown/DropdownPanel";
import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { FunnelIcon, HugeiconsIcon } from "@src/icons";

import {
  GITHUB_FACET,
  GITHUB_FACETS_BY_SCOPE,
  GITHUB_QUICK_FILTER,
  GITHUB_QUICK_FILTERS_BY_SCOPE,
  type GitHubFacetKey,
  type GitHubFacetOption,
  type GitHubQuickFilter,
  type GitHubWorkItemFacets,
  clearGitHubFilters,
  countActiveGitHubFilters,
  isGitHubFacetValueSelected,
  isGitHubQuickFilterActive,
  toggleGitHubFacetValue,
  toggleGitHubQuickFilter,
} from "./githubWorkItemsFilterFacets";
import type {
  GitHubQueryScope,
  ParsedGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";

const QUICK_FILTER_LABEL_KEYS: Record<GitHubQuickFilter, string> = {
  [GITHUB_QUICK_FILTER.CREATED_BY_ME]: "chat.panels.manageIssues.createdByMe",
  [GITHUB_QUICK_FILTER.ASSIGNED_TO_ME]: "chat.panels.manageIssues.assignedToMe",
  [GITHUB_QUICK_FILTER.REVIEW_REQUESTED_FROM_ME]:
    "chat.panels.manageIssues.filters.reviewRequestedFromMe",
  [GITHUB_QUICK_FILTER.NO_ASSIGNEE]:
    "chat.panels.manageIssues.filters.noAssignee",
  [GITHUB_QUICK_FILTER.NO_LABEL]: "chat.panels.manageIssues.filters.noLabel",
  [GITHUB_QUICK_FILTER.LINKED_PR]:
    "chat.panels.manageIssues.filters.linkedPullRequest",
  [GITHUB_QUICK_FILTER.DRAFT]: "chat.panels.manageIssues.filters.draft",
  [GITHUB_QUICK_FILTER.READY_FOR_REVIEW]:
    "chat.panels.manageIssues.filters.readyForReview",
  [GITHUB_QUICK_FILTER.RECENTLY_UPDATED]:
    "chat.panels.manageIssues.filters.recentlyUpdated",
  [GITHUB_QUICK_FILTER.STALE]: "chat.panels.manageIssues.filters.stale",
};

const FACET_LABEL_KEYS: Record<GitHubFacetKey, string> = {
  [GITHUB_FACET.AUTHOR]: "chat.panels.manageIssues.filters.facetAuthor",
  [GITHUB_FACET.ASSIGNEE]: "chat.panels.manageIssues.filters.facetAssignee",
  [GITHUB_FACET.LABEL]: "chat.panels.manageIssues.filters.facetLabel",
  [GITHUB_FACET.MILESTONE]: "chat.panels.manageIssues.filters.facetMilestone",
  [GITHUB_FACET.REVIEW_REQUESTED]:
    "chat.panels.manageIssues.filters.facetReviewRequested",
  [GITHUB_FACET.BASE_BRANCH]:
    "chat.panels.manageIssues.filters.facetBaseBranch",
  [GITHUB_FACET.CI_STATUS]: "chat.panels.manageIssues.filters.facetCiStatus",
};

const CI_STATUS_LABEL_KEYS: Record<string, string> = {
  success: "chat.panels.manageIssues.filters.ciSuccess",
  failure: "chat.panels.manageIssues.filters.ciFailure",
  pending: "chat.panels.manageIssues.filters.ciPending",
};

type UpdateSearchQuery = (
  mutate: (query: ParsedGitHubSearchQuery) => void
) => void;

export interface GitHubWorkItemsFilterMenuProps {
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  facets: GitHubWorkItemFacets;
  parsedSearchQuery: ParsedGitHubSearchQuery;
  updateSearchQuery: UpdateSearchQuery;
}

function FilterCheckbox({ checked }: { checked: boolean }): React.ReactNode {
  return <Checkbox checked={checked} className="size-4 shrink-0" />;
}

/**
 * The filter popover body. Every row rewrites the search query, so the
 * search box stays the single record of what is filtered and a hand-typed
 * qualifier shows up here as checked.
 */
export function GitHubWorkItemsFilterPanel({
  scope,
  facets,
  parsedSearchQuery,
  updateSearchQuery,
}: GitHubWorkItemsFilterMenuProps): React.ReactNode {
  const { t } = useTranslation("sessions");
  const [search, setSearch] = useState("");
  const [toggledFacets, setToggledFacets] = useState<
    Partial<Record<GitHubFacetKey, boolean>>
  >({});
  const normalizedSearch = search.trim().toLowerCase();
  const activeFilterCount = countActiveGitHubFilters(parsedSearchQuery);

  const getFacetOptionLabel = (facet: GitHubFacetKey, value: string) =>
    facet === GITHUB_FACET.CI_STATUS && CI_STATUS_LABEL_KEYS[value]
      ? t(CI_STATUS_LABEL_KEYS[value])
      : value;

  const quickFilters = GITHUB_QUICK_FILTERS_BY_SCOPE[scope]
    .map((filter) => ({ filter, label: t(QUICK_FILTER_LABEL_KEYS[filter]) }))
    .filter(({ label }) => label.toLowerCase().includes(normalizedSearch));

  const facetSections = GITHUB_FACETS_BY_SCOPE[scope]
    .map((facet) => {
      const options = facets[facet]
        .map((option: GitHubFacetOption) => ({
          ...option,
          label: getFacetOptionLabel(facet, option.value),
          selected: isGitHubFacetValueSelected(
            parsedSearchQuery,
            facet,
            option.value
          ),
        }))
        .filter(({ label }) => label.toLowerCase().includes(normalizedSearch));
      return { facet, options };
    })
    .filter(({ options }) => options.length > 0);

  const isEmpty = quickFilters.length === 0 && facetSections.length === 0;

  return (
    <DropdownPanel
      className={`flex flex-col ${DROPDOWN_WIDTHS.fileTreeClass}`}
      maxHeight="none"
    >
      <DropdownSearch
        value={search}
        onChange={setSearch}
        placeholder={t("chat.panels.manageIssues.filters.searchPlaceholder")}
        testId="github-work-items-filter-search"
      />
      {isEmpty ? (
        <div className={DROPDOWN_CLASSES.listMessage}>
          {t("chat.panels.manageIssues.filters.noMatches")}
        </div>
      ) : (
        // Taller than a plain option list: the value sections sit below the
        // quick filters and should be reachable without scrolling first.
        <div
          className={`${DROPDOWN_CLASSES.itemsColumnPadded} scrollbar-hide max-h-96 min-h-0 cursor-default overflow-y-auto`}
        >
          {quickFilters.map(({ filter, label }) => {
            const active = isGitHubQuickFilterActive(parsedSearchQuery, filter);
            return (
              <DropdownItem
                key={filter}
                icon={<FilterCheckbox checked={active} />}
                selected={active}
                showCheckmark={false}
                dataTestId={`github-work-items-quick-filter-${filter}`}
                onClick={() =>
                  updateSearchQuery((query) =>
                    toggleGitHubQuickFilter(query, filter)
                  )
                }
              >
                {label}
              </DropdownItem>
            );
          })}
          {facetSections.map(({ facet, options }) => {
            // A section with a checked value, or one the search narrowed,
            // opens on its own; a manual toggle always wins.
            const expanded =
              toggledFacets[facet] ??
              (normalizedSearch.length > 0 ||
                options.some((option) => option.selected));
            return (
              <React.Fragment key={facet}>
                <DropdownCollapsibleSectionHeader
                  expanded={expanded}
                  onToggle={() =>
                    setToggledFacets((current) => ({
                      ...current,
                      [facet]: !expanded,
                    }))
                  }
                >
                  {t(FACET_LABEL_KEYS[facet])}
                </DropdownCollapsibleSectionHeader>
                {expanded
                  ? options.map((option) => (
                      <DropdownItem
                        key={option.value}
                        icon={<FilterCheckbox checked={option.selected} />}
                        selected={option.selected}
                        showCheckmark={false}
                        suffix={
                          <span className="text-[11px] tabular-nums">
                            {option.count}
                          </span>
                        }
                        dataTestId={`github-work-items-facet-${facet}`}
                        onClick={() =>
                          updateSearchQuery((query) =>
                            toggleGitHubFacetValue(query, facet, option.value)
                          )
                        }
                      >
                        {option.label}
                      </DropdownItem>
                    ))
                  : null}
              </React.Fragment>
            );
          })}
        </div>
      )}
      <DropdownFooter className="justify-between">
        <span className="px-1.5 text-[11px] text-text-3">
          {t("chat.panels.manageIssues.filters.activeCount", {
            count: activeFilterCount,
          })}
        </span>
        <Button
          variant="tertiary"
          size="small"
          disabled={activeFilterCount === 0}
          data-testid="github-work-items-filter-clear"
          onClick={() => updateSearchQuery(clearGitHubFilters)}
        >
          {t("chat.panels.manageIssues.filters.clear")}
        </Button>
      </DropdownFooter>
    </DropdownPanel>
  );
}

/** Funnel button that opens the filter popover for issues or pull requests. */
export function GitHubWorkItemsFilterMenu(
  props: GitHubWorkItemsFilterMenuProps
): React.ReactNode {
  const { t } = useTranslation("common");
  const activeFilterCount = useMemo(
    () => countActiveGitHubFilters(props.parsedSearchQuery),
    [props.parsedSearchQuery]
  );
  const hasActiveFilters = activeFilterCount > 0;
  const filterLabel = t("actions.filter");

  return (
    <Dropdown
      position="bottom-end"
      droplist={<GitHubWorkItemsFilterPanel {...props} />}
    >
      <Button
        variant="tertiary"
        size="small"
        className={hasActiveFilters ? "bg-fill-1! text-primary-6!" : ""}
        icon={
          <HugeiconsIcon
            icon={FunnelIcon}
            data-icon="funnel"
            size={14}
            strokeWidth={1.8}
          />
        }
        iconOnly
        aria-label={
          hasActiveFilters
            ? `${filterLabel} (${activeFilterCount})`
            : filterLabel
        }
        aria-pressed={hasActiveFilters}
        data-testid="github-work-items-filter"
      />
    </Dropdown>
  );
}
