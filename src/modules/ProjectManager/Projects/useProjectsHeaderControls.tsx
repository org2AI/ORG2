import React, {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";

import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { WorkManagementSearchInput } from "@src/features/GitHubWork/WorkManagementSearchInput";
import {
  CircleIcon,
  Flag01Icon,
  HugeiconsIcon,
  TimeScheduleIcon,
} from "@src/icons";

import {
  type ProjectsGroupMode,
  type WorkspaceSourceMode,
} from "./projectsUtils";

interface UseProjectsHeaderControlsParams {
  groupMode: ProjectsGroupMode;
  setGroupMode: Dispatch<SetStateAction<ProjectsGroupMode>>;
  allowExternalSources: boolean;
  workspaceSourceMode: WorkspaceSourceMode;
  setWorkspaceSourceMode: Dispatch<SetStateAction<WorkspaceSourceMode>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  orgSurfaceControls?: React.ReactNode;
}

/**
 * Header control clusters for the Projects page: group-by select,
 * workspace source pills and the search input.
 */
export function useProjectsHeaderControls({
  groupMode,
  setGroupMode,
  allowExternalSources,
  workspaceSourceMode,
  setWorkspaceSourceMode,
  searchQuery,
  setSearchQuery,
  orgSurfaceControls,
}: UseProjectsHeaderControlsParams) {
  const { t } = useTranslation("projects");

  const groupModeOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: "status",
        label: (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <HugeiconsIcon
              icon={CircleIcon}
              data-icon="circle"
              size={13}
              strokeWidth={1.75}
            />
            <span>{t("projects.groupBy.status")}</span>
          </span>
        ),
        triggerLabel: t("projects.groupBy.status"),
      },
      {
        value: "priority",
        label: (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <HugeiconsIcon
              icon={Flag01Icon}
              data-icon="flag"
              size={13}
              strokeWidth={1.75}
            />
            <span>{t("projects.groupBy.priority")}</span>
          </span>
        ),
        triggerLabel: t("projects.groupBy.priority"),
      },
      {
        value: "targetDate",
        label: (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <HugeiconsIcon
              icon={TimeScheduleIcon}
              data-icon="calendar-clock"
              size={13}
              strokeWidth={1.75}
            />
            <span>{t("projects.groupBy.targetDate")}</span>
          </span>
        ),
        triggerLabel: t("projects.groupBy.targetDate"),
      },
    ],
    [t]
  );

  const handleGroupModeChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      setGroupMode(value as ProjectsGroupMode);
    },
    [setGroupMode]
  );

  const workspaceSourceTabs = useMemo<TabPillItem[]>(
    () => [
      { key: "local_only", label: t("projects.source.localOnly") },
      {
        key: "include_external",
        label: t("projects.source.includeExternal"),
      },
    ],
    [t]
  );

  const handleWorkspaceSourceModeChange = useCallback(
    (key: string) => {
      setWorkspaceSourceMode(key as WorkspaceSourceMode);
    },
    [setWorkspaceSourceMode]
  );

  const groupModeSelect = useMemo(
    () => (
      <Select
        value={groupMode}
        onChange={handleGroupModeChange}
        options={groupModeOptions}
        size="small"
        appearance="ghost"
        radius="lg"
        dropdownWidthMode="auto"
        dropdownAlign="left"
        className="w-auto"
      />
    ),
    [groupMode, groupModeOptions, handleGroupModeChange]
  );

  const sourceModeSwitch = useMemo(() => {
    if (!allowExternalSources) return null;
    return (
      <TabPill
        tabs={workspaceSourceTabs}
        activeTab={workspaceSourceMode}
        onChange={handleWorkspaceSourceModeChange}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    );
  }, [
    allowExternalSources,
    handleWorkspaceSourceModeChange,
    workspaceSourceMode,
    workspaceSourceTabs,
  ]);

  const headerLeadingControls = useMemo(
    () => (
      <div className="contents">
        {orgSurfaceControls}
        {orgSurfaceControls && <HeaderSectionSeparator />}
        {groupModeSelect}
        {sourceModeSwitch && <HeaderSectionSeparator />}
        {sourceModeSwitch}
      </div>
    ),
    [groupModeSelect, orgSurfaceControls, sourceModeSwitch]
  );
  const headerTrailingControls = useMemo(
    () => (
      <WorkManagementSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        dataTestId="projects-search"
      />
    ),
    [searchQuery, setSearchQuery]
  );

  return { headerLeadingControls, headerTrailingControls };
}
