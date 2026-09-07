import { useAtomValue } from "jotai";
import { useMemo } from "react";

import {
  getSidebarActiveCloudOrg,
  org2CloudOrgsAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { org2CloudRepoScopesAtom } from "@src/features/Org2Cloud/org2CloudSyncAtoms";

import {
  type OrgScopeFilterRepo,
  repoEligibleForOrgScopedPicker,
} from "./orgScopeRepoFilter";
import { useShareableScopeKeyVersion } from "./repoScopeResolver";

export type OrgScopeRepoPredicate = (repo: OrgScopeFilterRepo) => boolean;

export function useActiveCloudOrgName(): string | null {
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);

  return useMemo(
    () => getSidebarActiveCloudOrg(activeCloudOrgId, cloudOrgs)?.name ?? null,
    [activeCloudOrgId, cloudOrgs]
  );
}

export function useActiveCloudOrgRepoFilter(): OrgScopeRepoPredicate | null {
  const activeCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const scopesByOrg = useAtomValue(org2CloudRepoScopesAtom);
  const scopeKeyVersion = useShareableScopeKeyVersion();

  return useMemo(() => {
    void scopeKeyVersion;
    if (!activeCloudOrgId) return null;
    const orgScopes = scopesByOrg[activeCloudOrgId];
    if (!orgScopes || orgScopes.length === 0) return null;
    return (repo: OrgScopeFilterRepo) =>
      repoEligibleForOrgScopedPicker(repo, orgScopes);
  }, [activeCloudOrgId, scopesByOrg, scopeKeyVersion]);
}
