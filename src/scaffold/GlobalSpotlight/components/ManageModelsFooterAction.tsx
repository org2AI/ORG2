import { buildIntegrationsPath } from "@src/config/mainAppPaths";
import { ACTION_ID } from "@src/scaffold/ActionSystem";

import { SpotlightNavigationFooterAction } from "./SpotlightNavigationFooterAction";

export function ManageModelsFooterAction({ onClose }: { onClose: () => void }) {
  return (
    <SpotlightNavigationFooterAction
      onClose={onClose}
      labelKey="selectors.spotlightFooter.manageModels"
      actionId={ACTION_ID.APP_GO_TO_INTEGRATIONS}
      fallbackPath={buildIntegrationsPath({ category: "models" })}
    />
  );
}
