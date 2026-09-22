/**
 * ChatSplitRatioPicker
 *
 * The `general.chatPaneSplitRatio` presets, rendered inside the chat-pane
 * divider's hover popover so the split can be set from the boundary it
 * describes instead of only from the sidebar Layout menu.
 *
 * Picking a preset resizes the pane, which slides the divider out from under
 * the cursor — hence `onPicked`, which the handle uses to dismiss the popover
 * rather than leave it stranded beside a boundary that has moved.
 */
import { useAtom } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import {
  CHAT_SPLIT_RATIO_LABELS,
  CHAT_SPLIT_RATIO_VALUES,
  type ChatSplitRatio,
} from "@src/engines/ChatPanel/config";
import { chatSplitRatioAtom } from "@src/store/ui/chatPanel/splitRatioAtoms";

const OPTIONS = CHAT_SPLIT_RATIO_VALUES.map((value) => ({
  value,
  label: CHAT_SPLIT_RATIO_LABELS[value],
}));

export const ChatSplitRatioPicker: React.FC<{ onPicked?: () => void }> = ({
  onPicked,
}) => {
  const { t } = useTranslation("common");
  const [chatSplitRatio, setChatSplitRatio] = useAtom(chatSplitRatioAtom);
  const label = t("layoutSettings.chatSplitRatio");

  const handleChange = useCallback(
    (value: ChatSplitRatio) => {
      setChatSplitRatio(value);
      onPicked?.();
    },
    [onPicked, setChatSplitRatio]
  );

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-text-2">{label}</span>
      <SegmentedTextPill<ChatSplitRatio>
        ariaLabel={label}
        dataTestId="chat-split-ratio-divider-select"
        onChange={handleChange}
        options={OPTIONS}
        size="small"
        value={chatSplitRatio}
      />
    </div>
  );
};

ChatSplitRatioPicker.displayName = "ChatSplitRatioPicker";
