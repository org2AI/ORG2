import type { AddToAgentRequest } from "@src/store/ui/addToAgentAtom";

import { buildDomComponentJsonFromElementInfo } from "../BrowserLayout/buildDomComponentJson";
import type { ElementInfo } from "../hooks/useWebviewInspector";

/** Callers retain ownership of selection: My Station keeps it, replay clears it. */
export function sendSelectedElementToChat({
  selectedElement,
  currentUrl,
  setAddToAgent,
  onSent,
  clearSelection,
}: {
  selectedElement: ElementInfo | null;
  currentUrl: string;
  setAddToAgent: (request: AddToAgentRequest) => void;
  onSent: () => void;
  clearSelection?: () => void;
}): void {
  if (!selectedElement) return;
  const { jsonText, fileName } = buildDomComponentJsonFromElementInfo(
    selectedElement,
    currentUrl
  );
  setAddToAgent({ type: "dom-component", fileName, jsonText });
  clearSelection?.();
  onSent();
}
