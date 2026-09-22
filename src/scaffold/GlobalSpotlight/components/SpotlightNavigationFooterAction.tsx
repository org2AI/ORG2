import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger";
import { useAppNavigate } from "@src/hooks/navigation/useAppNavigate";
import {
  type ActionId,
  useActionSystemOptional,
} from "@src/scaffold/ActionSystem";

import { SpotlightFooterAction } from "./SpotlightFooterAction";

const log = createLogger("SpotlightNavigationFooterAction");

interface Props {
  onClose: () => void;
  labelKey: string;
  actionId: ActionId;
  fallbackPath: string;
}
export function SpotlightNavigationFooterAction({
  onClose,
  labelKey,
  actionId,
  fallbackPath,
}: Props) {
  const { t } = useTranslation("common");
  const navigate = useAppNavigate();
  const actionSystem = useActionSystemOptional();
  const onClick = useCallback(() => {
    onClose();
    if (actionSystem?.isValidAction(actionId)) {
      actionSystem.dispatch(actionId, {}, "user").catch((error: unknown) => {
        log.error("Failed to dispatch Spotlight navigation", error);
      });
    } else {
      navigate(fallbackPath);
    }
  }, [onClose, actionSystem, actionId, navigate, fallbackPath]);
  return <SpotlightFooterAction label={t(labelKey)} onClick={onClick} />;
}
