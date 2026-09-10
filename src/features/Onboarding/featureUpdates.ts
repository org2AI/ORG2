import { openBranchSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";

/** Curated shipped features. Add entries here when a discoverable feature ships. */
export const FEATURE_UPDATES = [
  {
    id: "spotlight-repository-branches",
    titleKey: "discovery.branchesTitle",
    descriptionKey: "discovery.branchesDescription",
    onOpen: () => openBranchSpotlight(),
  },
] as const;
