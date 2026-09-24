import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { HugeiconsIcon, Loading03Icon } from "@src/icons";

/** Visible feedback while chat content is unavailable, including lazy chunks. */
const ChatLoadingBlock: React.FC = memo(() => {
  const { t } = useTranslation("common");
  return (
    <span
      className={`${CHAT_PANEL_WIDTH_TOKENS.contentWidth} flex items-center gap-2 py-2 text-xs text-text-3`}
      data-testid="chat-loading-block"
      role="status"
      aria-busy="true"
    >
      <HugeiconsIcon
        icon={Loading03Icon}
        size={SPINNER_TOKENS.default}
        className="shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span>{t("status.loading")}</span>
    </span>
  );
});

ChatLoadingBlock.displayName = "ChatLoadingBlock";

export default ChatLoadingBlock;
