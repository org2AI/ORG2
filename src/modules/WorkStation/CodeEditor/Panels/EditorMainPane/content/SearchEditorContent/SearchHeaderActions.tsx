import React from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { CaseSensitiveIcon, RegexIcon, WholeWordIcon } from "@src/icons";

interface SearchHeaderActionsProps {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  onCaseSensitiveToggle: () => void;
  onWholeWordToggle: () => void;
  onRegexToggle: () => void;
}

export function SearchHeaderActions({
  caseSensitive,
  wholeWord,
  useRegex,
  onCaseSensitiveToggle,
  onWholeWordToggle,
  onRegexToggle,
}: SearchHeaderActionsProps) {
  const { t } = useTranslation();
  const actions = [
    {
      label: t("tooltips.matchCaseLabel"),
      icon: CaseSensitiveIcon,
      onClick: onCaseSensitiveToggle,
      pressed: caseSensitive,
    },
    {
      label: t("tooltips.matchWholeWordLabel"),
      icon: WholeWordIcon,
      onClick: onWholeWordToggle,
      pressed: wholeWord,
    },
    {
      label: t("tooltips.useRegexLabel"),
      icon: RegexIcon,
      onClick: onRegexToggle,
      pressed: useRegex,
    },
  ];
  return (
    <>
      {actions.map((action) => (
        <ToolbarTooltip key={action.label} label={action.label}>
          <Button
            variant="tertiary"
            className="aria-pressed:bg-surface-selected aria-pressed:text-primary-6"
            size="small"
            iconOnly
            icon={
              <AnyIcon
                icon={action.icon}
                size={HEADER_ICON_SIZE.sm}
                // CaseSensitive mixes a filled A with a stroked a. Forcing a
                // stroke outlines the filled path again and makes A too heavy.
                strokeWidth={action.icon === CaseSensitiveIcon ? undefined : 2}
              />
            }
            aria-label={action.label}
            aria-pressed={action.pressed}
            onClick={action.onClick}
          />
        </ToolbarTooltip>
      ))}
    </>
  );
}
