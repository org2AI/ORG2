import { useAtomValue } from "jotai";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import AnyIcon from "@src/components/AnyIcon";
import ModelIcon from "@src/components/ModelIcon";
import SelectorPill from "@src/components/SelectorPill";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { ConversationTargetReadiness } from "@src/engines/ChatPanel/conversationTargetSelection";
import {
  type AgentSelection,
  DispatchCategoryPalette,
} from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import { DispatchCategoryDropdown } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette/DispatchCategoryDropdown";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanelAtom";

interface ConversationRuntimePillProps {
  selection: AgentSelection | null;
  readiness: ConversationTargetReadiness;
  allowedCliAgentTypes: readonly CliAgentType[];
  onSelect: (selection: AgentSelection) => void;
}

/**
 * The ordinary New Session runtime picker, mounted beside the model picker.
 * The conversation layer owns only the selected value; option discovery and
 * presentation remain in DispatchCategoryPalette.
 */
const ConversationRuntimePill: React.FC<ConversationRuntimePillProps> = memo(
  ({ selection, readiness, allowedCliAgentTypes, onSelect }) => {
    const { t } = useTranslation();
    const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const visibleSelection = readiness === "ready" ? selection : null;

    const icon = useMemo(() => {
      if (visibleSelection?.cliAgentType) {
        return (
          <ModelIcon agentType={visibleSelection.cliAgentType} size={14} />
        );
      }
      return (
        <AnyIcon
          icon={resolveAgentIcon(visibleSelection?.agentIconId)}
          size={14}
          className="text-text-2"
        />
      );
    }, [visibleSelection]);

    const handleSelect = useCallback(
      (next: AgentSelection) => {
        onSelect(next);
        setIsOpen(false);
      },
      [onSelect]
    );

    const close = useCallback(() => setIsOpen(false), []);
    const disabled = readiness !== "ready";
    const effectiveIsOpen = isOpen && !disabled;
    const label =
      readiness === "loading"
        ? t("common:actions.loading")
        : (visibleSelection?.agentName ?? t("sessions:creator.selectAgent"));
    const sharedProps = {
      isOpen: effectiveIsOpen,
      onClose: close,
      onSelect: handleSelect,
      currentCategory: visibleSelection?.category,
      currentAgentDefinitionId: visibleSelection?.agentDefinitionId,
      currentCliAgentType: visibleSelection?.cliAgentType,
      hideOrgs: true,
      allowedCliAgentTypes,
    } as const;

    return (
      <>
        <SelectorPill
          ref={triggerRef}
          icon={icon}
          label={label}
          tooltip={t("sessions:creator.switchAgent")}
          tooltipPosition="top"
          active={effectiveIsOpen}
          disabled={disabled}
          onClick={() => setIsOpen((open) => !open)}
          size="sm"
          ariaLabel={label}
          dataTestId="chat-runtime-pill"
        />

        {modelPickerStyle === "dropdown" ? (
          <DispatchCategoryDropdown
            {...sharedProps}
            anchorRef={triggerRef}
            placement="top"
          />
        ) : (
          <DispatchCategoryPalette {...sharedProps} />
        )}
      </>
    );
  }
);

ConversationRuntimePill.displayName = "ConversationRuntimePill";

export default ConversationRuntimePill;
