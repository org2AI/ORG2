import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Select, { type SelectOption } from "@src/components/Select";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

/** Which side of the scope switch an organization entry belongs to. */
export type OrganizationScopeKind = "local" | "cloud";

export const ORGANIZATION_SCOPE: Record<
  Uppercase<OrganizationScopeKind>,
  OrganizationScopeKind
> = {
  LOCAL: "local",
  CLOUD: "cloud",
};

export interface OrganizationScopeOption extends SelectOption {
  scope: OrganizationScopeKind;
}

export interface OrganizationScopeHeaderProps {
  value: string;
  options: OrganizationScopeOption[];
  onChange: (value: string) => void;
  tabControl: React.ReactNode;
  dataTestId: string;
  selectorDataTestId: string;
}

/**
 * One gap for the whole header row, so every divider sits the same distance
 * from the control on either side of it — the nested control cluster and the
 * tab strip would otherwise space their dividers differently.
 */
const HEADER_GAP = "gap-3.5";

/** The header's one divider rule, between each pair of adjacent controls. */
function Divider({ testId }: { testId: string }) {
  return (
    <span
      className="h-5 w-px shrink-0 bg-border-2"
      role="separator"
      aria-hidden
      data-testid={testId}
    />
  );
}

/**
 * Shared `local | cloud switch → organization selector → tabs` header used by
 * organization-owned detail surfaces. Scope navigation stays controlled by the
 * owning feature; this component owns only the common layout, the scope
 * switch, and the selector presentation.
 *
 * The switch is the primary control: local is the resting scope. The cloud
 * scope always names the organization it is pointed at, because which cloud
 * workspace the surface is reading is never implied by the segment alone. The
 * local scope names itself, so it adds a selector only when there is actually
 * more than one local organization to pick between.
 */
export function OrganizationScopeHeader({
  value,
  options,
  onChange,
  tabControl,
  dataTestId,
  selectorDataTestId,
}: OrganizationScopeHeaderProps) {
  const { t } = useTranslation("projects");

  const optionsByScope = useMemo(() => {
    const local: OrganizationScopeOption[] = [];
    const cloud: OrganizationScopeOption[] = [];
    for (const option of options) {
      (option.scope === ORGANIZATION_SCOPE.CLOUD ? cloud : local).push(option);
    }
    return { local, cloud };
  }, [options]);

  const activeScope: OrganizationScopeKind =
    options.find((option) => option.value === value)?.scope ??
    ORGANIZATION_SCOPE.LOCAL;
  const scopedOptions = optionsByScope[activeScope];
  const showSelector =
    activeScope === ORGANIZATION_SCOPE.CLOUD
      ? scopedOptions.length > 0
      : scopedOptions.length > 1;

  // Returning to a scope should land on the organization it was left on, not
  // reset to its first entry. Owned here because the committed value is the
  // caller's — this only remembers what the caller already committed.
  const lastValueByScope = useRef<Record<OrganizationScopeKind, string | null>>(
    { local: null, cloud: null }
  );
  useEffect(() => {
    lastValueByScope.current[activeScope] = value;
  }, [activeScope, value]);

  const handleScopeChange = useCallback(
    (nextScope: OrganizationScopeKind) => {
      if (nextScope === activeScope) return;
      const candidates = optionsByScope[nextScope];
      if (candidates.length === 0) return;
      const remembered = lastValueByScope.current[nextScope];
      const target =
        candidates.find((option) => option.value === remembered) ??
        candidates[0];
      onChange(String(target.value));
    },
    [activeScope, onChange, optionsByScope]
  );

  return (
    <div
      className="sticky top-0 z-20 shrink-0 bg-chat-pane"
      data-testid={dataTestId}
    >
      <div
        className={`${DETAIL_PANEL_TOKENS.headerWidth} ${HEADER_GAP} flex h-14 min-w-0 items-center px-4 pt-1`}
      >
        <div className={`${HEADER_GAP} flex -translate-y-1 items-center`}>
          <SegmentedTextPill<OrganizationScopeKind>
            ariaLabel={t("orgs.scopeSwitch")}
            dataTestId={`${selectorDataTestId}-scope`}
            size="large"
            value={activeScope}
            options={[
              {
                value: ORGANIZATION_SCOPE.LOCAL,
                label: t("orgs.scope.local"),
                disabled: optionsByScope.local.length === 0,
              },
              {
                value: ORGANIZATION_SCOPE.CLOUD,
                label: t("orgs.scope.cloud"),
                disabled: optionsByScope.cloud.length === 0,
              },
            ]}
            onChange={handleScopeChange}
          />
          {showSelector ? (
            <>
              <Divider testId={`${selectorDataTestId}-scope-separator`} />
              <Select
                value={value}
                options={scopedOptions}
                onChange={(nextValue) => {
                  if (Array.isArray(nextValue)) return;
                  onChange(String(nextValue));
                }}
                showSearch={scopedOptions.length > 8}
                size="large"
                appearance="bare"
                radius="pill"
                dropdownMinWidth={168}
                dropdownWidthMode="auto"
                className="select-title-row w-auto shrink-0"
                selectorClassName="max-w-[240px] gap-2! px-1! text-[16px]! leading-6! [&_.select-suffix]:ml-0!"
                dataTestId={selectorDataTestId}
              />
            </>
          ) : null}
          <Divider testId={`${selectorDataTestId}-separator`} />
        </div>
        <div className="scrollbar-hide min-w-0 overflow-x-auto">
          {tabControl}
        </div>
      </div>
    </div>
  );
}

export default OrganizationScopeHeader;
