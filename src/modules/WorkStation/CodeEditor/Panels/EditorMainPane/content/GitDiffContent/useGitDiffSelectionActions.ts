/**
 * Text-selection dropdown of `GitDiffContent`: the anchored selection state
 * plus the "ask agent" / "add to context" handoffs into the station chat.
 */
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { Message } from "@src/components/Message";
import type { TextSelectionInfo } from "@src/features/CodeMirror";
import { activeStationChatVisibleAtom, addToAgentAtom } from "@src/store/ui";

import type { SelectionDropdownState } from "./types";

export function useGitDiffSelectionActions({
  effectiveGitFilePath,
  t,
}: {
  effectiveGitFilePath: string | undefined;
  t: TFunction;
}) {
  const setAddToAgent = useSetAtom(addToAgentAtom);
  const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
  const [selectionDropdown, setSelectionDropdown] =
    useState<SelectionDropdownState | null>(null);
  const selectionDropdownRef = useRef(selectionDropdown);

  useEffect(() => {
    selectionDropdownRef.current = selectionDropdown;
  }, [selectionDropdown]);

  const handleTextSelection = useCallback(
    (selection: TextSelectionInfo | null) => {
      if (selection && effectiveGitFilePath) {
        setSelectionDropdown({
          visible: true,
          position: selection.position,
          text: selection.text,
          fromLine: selection.fromLine,
          toLine: selection.toLine,
        });
      } else {
        setSelectionDropdown(null);
      }
    },
    [effectiveGitFilePath]
  );

  const handleCloseSelectionDropdown = useCallback(() => {
    setSelectionDropdown(null);
  }, []);

  const handleAskAgent = useCallback(
    (_text: string) => {
      const currentSelection = selectionDropdownRef.current;
      if (!effectiveGitFilePath || !currentSelection) return;

      const fileName =
        effectiveGitFilePath.split("/").pop() || effectiveGitFilePath;

      setStationChatVisible("my-station", true);
      setAddToAgent({
        type: "lines",
        filePath: effectiveGitFilePath,
        fileName,
        lineStart: currentSelection.fromLine,
        lineEnd: currentSelection.toLine,
      });

      Message.success(
        t("workstation.addedToAgent", {
          fileName: `Lines ${currentSelection.fromLine}~${currentSelection.toLine}`,
        })
      );
    },
    [effectiveGitFilePath, setAddToAgent, setStationChatVisible, t]
  );

  const handleAddToContext = useCallback(
    (_text: string, _sessionId: string | null) => {
      if (!effectiveGitFilePath) return;

      const fileName =
        effectiveGitFilePath.split("/").pop() || effectiveGitFilePath;

      setStationChatVisible("my-station", true);
      setAddToAgent({
        type: "file",
        filePath: effectiveGitFilePath,
        fileName,
      });

      Message.success(t("workstation.addedToAgent", { fileName }));
    },
    [effectiveGitFilePath, setAddToAgent, setStationChatVisible, t]
  );

  return {
    handleAddToContext,
    handleAskAgent,
    handleCloseSelectionDropdown,
    handleTextSelection,
    selectionDropdown,
  };
}
