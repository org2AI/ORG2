import type { ReactNode } from "react";

import PanelFooter, {
  type PanelFooterAction,
} from "@src/components/layout/blocks/PanelFooter";

interface SpotlightFormActionsProps {
  backLabel: string;
  onBack: () => void;
  busy: boolean;
  submit: PanelFooterAction;
  left?: ReactNode;
}

/** Shared form policy; callers retain validation, labels and native submit intent. */
export function SpotlightFormActions({
  backLabel,
  onBack,
  busy,
  submit,
  left,
}: SpotlightFormActionsProps) {
  return (
    <PanelFooter
      secondaryButtonSize="default"
      primaryButtonSize="default"
      left={left}
      secondaryActions={[
        {
          label: backLabel,
          onClick: onBack,
          variant: "secondary",
          disabled: busy,
        },
      ]}
      primaryAction={{
        ...submit,
        disabled: busy || submit.disabled,
        loading: busy,
        variant: submit.variant ?? "primary",
      }}
    />
  );
}
