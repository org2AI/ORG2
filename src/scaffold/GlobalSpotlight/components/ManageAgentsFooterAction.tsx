import { ROUTES } from "@src/config/routes";
import { ACTION_ID } from "@src/scaffold/ActionSystem";

import { SpotlightNavigationFooterAction } from "./SpotlightNavigationFooterAction";

export function ManageAgentsFooterAction({ onClose }: { onClose: () => void }) {
  return (
    <SpotlightNavigationFooterAction
      onClose={onClose}
      labelKey="selectors.spotlightFooter.manageAgents"
      actionId={ACTION_ID.APP_GO_TO_AGENT_ORGS}
      fallbackPath={ROUTES.app.agentOrgs.path}
    />
  );
}
