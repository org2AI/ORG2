/**
 * Team Sessions "who posted this" member-filter dropdown
 * (`cloudSessionsSection.tsx`): the portal-rendered option list (everyone /
 * directly shared with me / each roster member, with online dot + "viewing"
 * subtitle) plus the "show hidden" reveal row, and the state/handlers that
 * back it (filter selection and hidden-row count). Search, keyboard navigation,
 * dismissal and scrolling use the shared Dropdown options API.
 */
import type { TFunction } from "i18next";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import Dropdown from "@src/components/Dropdown";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { HIDDEN_REMOTE_SESSIONS_STORAGE_KEY } from "@src/features/Org2Cloud/cloudHiddenRemoteSessions";
import {
  type CloudSessionFilter,
  buildCloudSessionMemberFilterOptions,
} from "@src/features/Org2Cloud/cloudSessionFilter";
import type { CloudOrgMember } from "@src/features/Org2Cloud/org2CloudClient";
import type { Org2CloudPresenceEntry } from "@src/features/Org2Cloud/org2CloudPresenceAtom";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";

import type { MemberFilterMenuState } from "./cloudSessionsSection.types";

interface UseCloudMemberFilterDropdownParams {
  orgId: string | null;
  filter: CloudSessionFilter;
  memberMenu: MemberFilterMenuState | null;
  setMemberMenu: Dispatch<SetStateAction<MemberFilterMenuState | null>>;
  rows: readonly RemoteTeammateSessionMetadata[];
  rosterMembers: CloudOrgMember[] | null;
  hiddenRemoteSessionIds: ReadonlySet<string>;
  setHiddenRemoteSessionIds: Dispatch<SetStateAction<Set<string>>>;
  presenceMap: Record<string, Record<string, Org2CloudPresenceEntry>>;
  onFilterChange: (filter: CloudSessionFilter) => void;
  t: TFunction;
}

export function useCloudMemberFilterDropdown({
  orgId,
  filter,
  memberMenu,
  setMemberMenu,
  rows,
  rosterMembers,
  hiddenRemoteSessionIds,
  setHiddenRemoteSessionIds,
  presenceMap,
  onFilterChange,
  t,
}: UseCloudMemberFilterDropdownParams): ReactNode {
  // Everyone + the active roster. Current rows are only a loading/legacy
  // fallback; a teammate does not need to publish a Session before they can
  // be selected as a filter.
  const memberOptions = useMemo(() => {
    return buildCloudSessionMemberFilterOptions(rows, rosterMembers);
  }, [rosterMembers, rows]);

  const closeMemberMenu = useCallback(
    () => setMemberMenu(null),
    [setMemberMenu]
  );
  const handleFilterSelect = useCallback(
    (nextFilter: CloudSessionFilter) => {
      onFilterChange(nextFilter);
      setMemberMenu(null);
    },
    [onFilterChange, setMemberMenu]
  );

  // Rows the viewer hid via the row menu; this dropdown entry is the only way back.
  const hiddenCountForOrg = useMemo(() => {
    if (!orgId) return 0;
    let count = 0;
    for (const key of hiddenRemoteSessionIds) {
      if (key.startsWith(`${orgId}|`)) count += 1;
    }
    return count;
  }, [hiddenRemoteSessionIds, orgId]);
  const handleShowHidden = useCallback(() => {
    if (!orgId) return;
    setHiddenRemoteSessionIds((current) => {
      const next = new Set(
        [...current].filter((key) => !key.startsWith(`${orgId}|`))
      );
      localStorage.setItem(
        HIDDEN_REMOTE_SESSIONS_STORAGE_KEY,
        JSON.stringify([...next])
      );
      return next;
    });
    setMemberMenu(null);
  }, [orgId, setHiddenRemoteSessionIds, setMemberMenu]);

  if (!memberMenu) return null;

  const filterOptions = [
    {
      key: "everyone",
      filter: { kind: "all" } as CloudSessionFilter,
      displayName: t("cloud.sidebar.everyone"),
      userId: null as string | null,
    },
    {
      key: "directly-shared-with-me",
      filter: {
        kind: "directlySharedWithMe",
      } as CloudSessionFilter,
      displayName: t("cloud.sidebar.directlySharedWithMe"),
      userId: null as string | null,
    },
    ...memberOptions.map((option) => ({
      key: `member-${option.userId}`,
      filter: {
        kind: "member",
        ownerUserId: option.userId,
      } as CloudSessionFilter,
      ...option,
    })),
  ];
  const options = filterOptions.map((option) => {
    const presenceEntry = option.userId
      ? (orgId ? presenceMap[orgId] : undefined)?.[option.userId]
      : undefined;
    const viewingRow = presenceEntry?.viewingSessionId
      ? rows.find(
          (row) => row.sourceSessionId === presenceEntry.viewingSessionId
        )
      : undefined;
    const viewingTitle = viewingRow
      ? viewingRow.title.replace(/^(?:⑂\s*)+/u, "")
      : undefined;

    return {
      value: option.key,
      triggerLabel: option.displayName,
      dataTestId: `sidebar-cloud-filter-${option.key}`,
      label: (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {presenceEntry && (
              <span
                data-testid="member-online-dot"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-6"
              />
            )}
            <span className="min-w-0 truncate">{option.displayName}</span>
          </span>
          {viewingTitle && (
            <span className="min-w-0 truncate pl-3 text-[10px] text-text-3">
              {t("cloud.sidebar.memberViewing", {
                title: viewingTitle,
              })}
            </span>
          )}
        </span>
      ),
    };
  });
  const selectedValue =
    filter.kind === "member"
      ? `member-${filter.ownerUserId}`
      : filter.kind === "directlySharedWithMe"
        ? "directly-shared-with-me"
        : "everyone";

  return createPortal(
    <div
      // Fixed positioning creates a stacking context; the portal root must
      // own the overlay layer so its child panel can appear above the app.
      className={`fixed flex ${DROPDOWN_PANEL.zIndexClass}`}
      style={{ top: memberMenu.top, left: memberMenu.left }}
      data-testid="sidebar-cloud-member-filter"
    >
      <Dropdown
        popupVisible
        onVisibleChange={(visible) => {
          if (!visible) closeMemberMenu();
        }}
        position="bottom-start"
        className={`${DROPDOWN_CLASSES.panelAnimated} ${DROPDOWN_WIDTHS.sidebarMenuClass} flex flex-col`}
        // memberMenu already includes the gap below the real filter button.
        style={{ maxHeight: DROPDOWN_PANEL.maxHeight, marginTop: 0 }}
        showSearch
        options={options}
        value={selectedValue}
        filterOption={(query, option) =>
          String(option.triggerLabel)
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        }
        onSelect={(value) => {
          const option = filterOptions.find((entry) => entry.key === value);
          if (option) handleFilterSelect(option.filter);
        }}
        dropdownRender={(menu) => (
          <>
            {menu}
            {hiddenCountForOrg > 0 && (
              <div className="shrink-0">
                <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
                <DropdownItem onClick={handleShowHidden}>
                  <span className="min-w-0 truncate">
                    {t("cloud.sidebar.showHidden", {
                      count: hiddenCountForOrg,
                    })}
                  </span>
                </DropdownItem>
              </div>
            )}
          </>
        )}
      >
        {/* A block anchor has no inline line box to push the panel down. */}
        <span aria-hidden="true" className="block size-0" />
      </Dropdown>
    </div>,
    document.body
  );
}
