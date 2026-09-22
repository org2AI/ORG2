import type { createStore } from "jotai";

import { sidebarSelectedOrgIdAtom } from "@src/features/Organizations/sidebarOrgScopeAtom";
import { DEFAULT_SESSION_ORG_ID } from "@src/store/session/creatorStateAtom";

import {
  beginOrg2CloudOrgsRequest,
  buildCloudOrgSelectorValue,
  commitOrg2CloudOrgsRequest,
  org2CloudOrgsAtom,
} from "./org2CloudOrgsAtom";

/** Existing consumer fixtures must seed the sources, not write the projection. */
export function seedSidebarCloudScope(
  store: ReturnType<typeof createStore>,
  orgId: string | null
): void {
  commitOrg2CloudOrgsRequest(
    store,
    beginOrg2CloudOrgsRequest(store),
    store.get(org2CloudOrgsAtom)
  );
  store.set(
    sidebarSelectedOrgIdAtom,
    orgId ? buildCloudOrgSelectorValue(orgId) : DEFAULT_SESSION_ORG_ID
  );
}
