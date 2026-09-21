/**
 * Import Settings Section
 *
 * Local sources for external coding-agent sessions, in two tabs:
 *   - `scanning` — detected apps/CLIs, import toggles, scan frequency, rescan
 *   - `hooks` — session-provenance capture hooks and their recent signals
 *
 * Both bodies live in `features/ExternalSessionSources` and are shared with
 * the Runtime pane, which renders them under its own section titles. Each tab
 * is code-split so only the open one loads.
 */
import React, { Suspense, lazy } from "react";

import { Placeholder } from "@src/components/Placeholder";

const IMPORT_TAB_KEYS = {
  SCANNING: "scanning",
  HOOKS: "hooks",
} as const;

const SourceScanningSettings = lazy(
  () => import("@src/features/ExternalSessionSources/SourceScanningSettings")
);
const SessionProvenanceHooksSettings = lazy(
  () =>
    import("@src/features/ExternalSessionSources/SessionProvenanceHooksSettings")
);

interface ImportSectionProps {
  activeTab?: string;
}

const ImportSection: React.FC<ImportSectionProps> = ({
  activeTab = IMPORT_TAB_KEYS.SCANNING,
}) => (
  <Suspense
    fallback={<Placeholder variant="loading" placement="detail-panel" />}
  >
    {activeTab === IMPORT_TAB_KEYS.HOOKS ? (
      <SessionProvenanceHooksSettings />
    ) : (
      <SourceScanningSettings />
    )}
  </Suspense>
);

export default ImportSection;
