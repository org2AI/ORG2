import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import type { SessionFollowUpSuggestion } from "@src/api/services/sessionFollowUpSuggestions";
import Button from "@src/components/Button";
import { COMPOSER_STACK_INSET_PX_CLASS } from "@src/config/composerStackTokens";

interface FollowUpSuggestionBarProps {
  suggestions: ReadonlyArray<SessionFollowUpSuggestion>;
  disabled?: boolean;
  onSelect: (suggestion: SessionFollowUpSuggestion) => void;
}

const FollowUpSuggestionBar: React.FC<FollowUpSuggestionBarProps> = memo(
  ({ suggestions, disabled = false, onSelect }) => {
    const { t } = useTranslation("sessions");
    if (suggestions.length === 0) return null;

    return (
      <div
        role="group"
        aria-label={t("input.followUpSuggestions.label")}
        data-testid="follow-up-suggestions"
        className={`flex max-w-full flex-wrap items-center gap-1.5 pb-0.5 ${COMPOSER_STACK_INSET_PX_CLASS}`}
      >
        {suggestions.map((suggestion) => (
          <Button
            key={`${suggestion.label}\0${suggestion.prompt}`}
            hoverTone={suggestion.primary ? "primary" : undefined}
            size="mini"
            shape="round"
            disabled={disabled}
            title={suggestion.prompt}
            onClick={() => onSelect(suggestion)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
    );
  }
);

FollowUpSuggestionBar.displayName = "FollowUpSuggestionBar";

export default FollowUpSuggestionBar;
