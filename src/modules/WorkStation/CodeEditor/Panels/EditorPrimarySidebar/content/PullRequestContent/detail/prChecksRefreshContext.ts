import { createContext } from "react";

export interface PrChecksRefreshValue {
  /** Re-polls the pull request and the checks on its head commit. */
  refreshChecks: () => Promise<void>;
  /** A re-poll — manual or scheduled — is in flight. */
  refreshing: boolean;
}

/**
 * Provided once by `PrDetailPanel`, so every surface that lists the head
 * commit's checks (the rail's checks panel, the merge box, the Checks tab) can
 * offer the same re-poll without threading it through the components between.
 * Absent outside a mounted pull request, where the button renders nothing.
 */
export const PrChecksRefreshContext =
  createContext<PrChecksRefreshValue | null>(null);
PrChecksRefreshContext.displayName = "PrChecksRefreshContext";
