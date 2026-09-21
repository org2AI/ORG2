import type { OpenPRItem } from "@src/api/tauri/github";
import type { SectionStatus } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionStatusRow";

export type PrVirtualRow =
  | { kind: "header"; section: "open" | "closed" }
  | { kind: "status"; section: "open" | "closed"; status: SectionStatus }
  | { kind: "pr"; pr: OpenPRItem };
