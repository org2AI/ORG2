/**
 * Session-provenance hook settings: managed capture per platform plus the
 * recent provenance signals. The two tables stay independent so each owns its
 * async state.
 *
 * Title-less on purpose: Settings → Import and Runtime → Hooks both render
 * this body and each supplies its own page chrome.
 */
import React from "react";

import { SECTION_GAP_CLASSES } from "@src/components/layout/Section";

import HookPlatformsTable from "./SessionProvenanceHookPlatformsTable";
import RecentSignalsTable from "./SessionProvenanceRecentSignalsTable";

const SessionProvenanceHooksSettings: React.FC = () => (
  <div
    className={SECTION_GAP_CLASSES}
    data-testid="session-provenance-hooks-settings"
  >
    <HookPlatformsTable />
    <RecentSignalsTable />
  </div>
);

export default SessionProvenanceHooksSettings;
