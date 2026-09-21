import { useCallback, useEffect, useRef, useState } from "react";

import type { ReviewDiffSearch } from "@src/features/CodeMirror/Diff/reviewSearchNavigation";

import type { DiffFileSectionData } from "./types";

interface UseDiffFileSectionExpansionOptions {
  file: DiffFileSectionData;
  reviewSearch?: ReviewDiffSearch;
  defaultExpanded: boolean;
  expansionSignal: number;
  isDeleted: boolean;
  onRequestContent?: (file: DiffFileSectionData) => void;
  onExpansionChange?: (expanded: boolean) => void;
}

/**
 * Expanded state for one diff section: a manual toggle scoped to the current
 * `expansionSignal`, forced open by a review-search match. Requests missing
 * content when opened and reports expansion changes to the parent.
 */
export function useDiffFileSectionExpansion({
  file,
  reviewSearch,
  defaultExpanded,
  expansionSignal,
  isDeleted,
  onRequestContent,
  onExpansionChange,
}: UseDiffFileSectionExpansionOptions): {
  expanded: boolean;
  toggleExpanded: () => void;
} {
  const [manualExpanded, setManualExpanded] = useState<{
    signal: number;
    value: boolean;
  } | null>(null);
  const expanded = reviewSearch?.match
    ? true
    : manualExpanded?.signal === expansionSignal
      ? manualExpanded.value
      : defaultExpanded;
  const previousExpandedRef = useRef(expanded);

  useEffect(() => {
    if (!expanded) return;
    if (isDeleted) return;
    if (
      file.oldContent !== undefined ||
      file.newContent !== undefined ||
      file.unifiedDiff !== undefined
    ) {
      return;
    }
    onRequestContent?.(file);
  }, [expanded, file, isDeleted, onRequestContent]);

  useEffect(() => {
    if (previousExpandedRef.current === expanded) return;
    previousExpandedRef.current = expanded;
    onExpansionChange?.(expanded);
  }, [expanded, onExpansionChange]);

  const toggleExpanded = useCallback(() => {
    setManualExpanded({ signal: expansionSignal, value: !expanded });
  }, [expanded, expansionSignal]);

  return { expanded, toggleExpanded };
}
