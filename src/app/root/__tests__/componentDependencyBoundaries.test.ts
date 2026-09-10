import path from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT, walkStaticImports } from "@src/test/staticImportGraph";

// Pure state/configuration and small consumers must not acquire their owning
// feature's rendering implementation through a convenience import.
const boundaries = [
  {
    entry: "components/StatusDot/index.tsx",
    forbidden: "components/SettingsTable/index.tsx",
  },
  {
    entry:
      "app/root/services/GlobalDragDrop/useGlobalDragDrop/utils/dragDetection.ts",
    forbidden: "engines/ChatPanel/InputArea/components/QueuedMessages.tsx",
  },
  {
    entry: "features/TeamCollaboration/forkDialogState.ts",
    forbidden:
      "features/TeamCollaboration/components/ForkSessionSetupDialog/index.tsx",
  },
  {
    entry: "features/TeamCollaboration/forkWorkspaceResolution.ts",
    forbidden:
      "features/TeamCollaboration/components/ForkCheckoutPickerDialog/index.tsx",
  },
  {
    entry: "features/TeamCollaboration/forkWorkspaceResolution.ts",
    forbidden:
      "features/TeamCollaboration/components/ForkSessionSetupDialog/index.tsx",
  },
  {
    entry: "modules/ProjectManager/WorkItems/workItemsViewModel.ts",
    forbidden: "features/KanbanBoard/index.tsx",
  },
  {
    entry:
      "modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/SourceControlStickyHeader.tsx",
    forbidden: "components/VirtualizedStickyTree/index.tsx",
  },
  {
    entry: "modules/WorkStation/Browser/shared/urlBarFocus.ts",
    forbidden:
      "modules/WorkStation/Browser/Panels/BrowserMainPane/components/WebUrlBar/index.tsx",
  },
  {
    entry: "util/customModelIdentity.ts",
    forbidden:
      "modules/MainApp/Integrations/KeyVault/shared/ModelTable/unifiedCustomFlatExtras.tsx",
  },
] as const;

describe("component dependency boundaries", () => {
  it.each(boundaries)(
    "$entry stays independent of $forbidden",
    ({ entry, forbidden }) => {
      const graph = walkStaticImports([entry]);
      expect(
        graph.files.has(path.join(SRC_ROOT, forbidden)),
        graph.explain(forbidden)
      ).toBe(false);
    }
  );
});
