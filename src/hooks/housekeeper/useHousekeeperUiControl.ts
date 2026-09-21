import { useCallback } from "react";
import { useLocation } from "react-router-dom";

import { housekeeperUiIntent } from "@src/api/services/keyValidation";
import Message from "@src/components/Message";
import { useActionSystemOptional } from "@src/scaffold/ActionSystem";

import {
  HOUSEKEEPER_ALLOWED_ACTION_IDS,
  HOUSEKEEPER_CONFIDENCE_THRESHOLD,
} from "./constants";
import { useHousekeeperConfig } from "./useHousekeeperConfig";

export function useHousekeeperUiControl() {
  const location = useLocation();
  const actionSystem = useActionSystemOptional();
  const housekeeper = useHousekeeperConfig();

  const tryRunHousekeeperUiControl = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (
        !trimmed ||
        !actionSystem ||
        !housekeeper.enabled ||
        !housekeeper.features.uiControl
      ) {
        return false;
      }

      try {
        const intent = await housekeeperUiIntent(trimmed, {
          accountId: housekeeper.resolvedAccountId ?? undefined,
          model: housekeeper.resolvedModel,
          allowedActionIds: [...HOUSEKEEPER_ALLOWED_ACTION_IDS],
          uiContext: {
            route: `${location.pathname}${location.search}`,
            activePanel: "ade-manager",
          },
        });

        if (
          !intent.actionId ||
          intent.confidence < HOUSEKEEPER_CONFIDENCE_THRESHOLD ||
          !actionSystem.isValidAction(intent.actionId)
        ) {
          return false;
        }

        const result = await actionSystem.dispatch(
          intent.actionId,
          intent.params,
          "ai"
        );
        if (!result.success) return false;
        Message.success(result.message);
        return true;
      } catch {
        return false;
      }
    },
    [
      actionSystem,
      housekeeper.enabled,
      housekeeper.features.uiControl,
      housekeeper.resolvedAccountId,
      housekeeper.resolvedModel,
      location.pathname,
      location.search,
    ]
  );

  return { tryRunHousekeeperUiControl };
}
