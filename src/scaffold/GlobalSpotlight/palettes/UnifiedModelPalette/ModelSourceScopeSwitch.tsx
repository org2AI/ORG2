/**
 * ModelSourceScopeSwitch
 *
 * Icon-only segmented switch (same control as the GUI / TUI launch switch)
 * picking which kind of credential the model palette's browse columns list:
 * the user's own Key Vault keys, or packages bought on ORG2 Market.
 *
 * Leads the palette's search row, in the magnifier's slot — the position and
 * size the GUI / TUI launch pill holds in the composer's info line. It is
 * always present, including before anything is bought: picking Market with
 * no package is how the user finds the prompt to buy one.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { HugeiconsIcon, Key02Icon, Store01Icon } from "@src/icons";
import {
  MODEL_SOURCE_SCOPE,
  type ModelSourceScope,
} from "@src/store/ui/spotlightModelSourceScopeAtom";

export const MODEL_SOURCE_SCOPE_SWITCH_TEST_ID = "model-source-scope-switch";

const ICON_SIZE = 14;

export interface ModelSourceScopeSwitchProps {
  value: ModelSourceScope;
  onChange: (scope: ModelSourceScope) => void;
}

export const ModelSourceScopeSwitch: React.FC<ModelSourceScopeSwitchProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();

  const segments: {
    value: ModelSourceScope;
    icon: typeof Key02Icon;
    label: string;
  }[] = [
    {
      value: MODEL_SOURCE_SCOPE.KEYS,
      icon: Key02Icon,
      label: t("selectors.modelSelector.sourceScope.keys"),
    },
    {
      value: MODEL_SOURCE_SCOPE.MARKET,
      icon: Store01Icon,
      // The palette names Market rows with this same string everywhere.
      label: t("integrations:marketConnection.title"),
    },
  ];

  return (
    <SegmentedTextPill
      ariaLabel={t("selectors.modelSelector.sourceScope.label")}
      className="shrink-0"
      dataTestId={MODEL_SOURCE_SCOPE_SWITCH_TEST_ID}
      tooltipPosition="bottom"
      value={value}
      options={segments.map((segment) => ({
        value: segment.value,
        ariaLabel: segment.label,
        tooltip: segment.label,
        label: <HugeiconsIcon icon={segment.icon} size={ICON_SIZE} />,
      }))}
      onChange={onChange}
    />
  );
};

export default ModelSourceScopeSwitch;
