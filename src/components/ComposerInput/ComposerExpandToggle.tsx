import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { PILL_CONTROL_HOVER_CLASS } from "@src/components/CompoundPill/config";
import Tooltip from "@src/components/Tooltip";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  HugeiconsIcon,
} from "@src/icons";

interface ComposerExpandToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Composer toolbar control that grows the editor into a taller writing
 * surface and back (see `useComposerExpansion`). Sits immediately left of the
 * microphone and matches its round icon-button treatment.
 */
const ComposerExpandToggle: React.FC<ComposerExpandToggleProps> = memo(
  ({ expanded, onToggle }) => {
    const { t } = useTranslation();
    const label = expanded
      ? t("common:tooltips.collapseInput")
      : t("common:tooltips.expandInput");

    return (
      <Tooltip content={label} position="top" kind="button">
        <span className="inline-flex">
          <Button
            layout="custom"
            aria-label={label}
            aria-expanded={expanded}
            data-testid="composer-expand-toggle"
            className={`flex ${INPUT_AREA_BUTTONS.iconButtonSizeClass} shrink-0 cursor-pointer items-center justify-center rounded-full leading-none text-text-1 transition-colors duration-200 focus:outline-none ${PILL_CONTROL_HOVER_CLASS}`}
            style={{ lineHeight: 0 }}
            // Keep focus and the caret in the document while clicking.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggle}
          >
            <HugeiconsIcon
              icon={expanded ? ArrowShrink02Icon : ArrowExpand01Icon}
              data-icon={expanded ? "minimize-2" : "maximize-2"}
              size={INPUT_AREA_BUTTONS.iconSize}
              strokeWidth={1.75}
              className="block"
            />
          </Button>
        </span>
      </Tooltip>
    );
  }
);

ComposerExpandToggle.displayName = "ComposerExpandToggle";

export default ComposerExpandToggle;
