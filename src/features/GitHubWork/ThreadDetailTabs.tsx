import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import DetailTabStrip from "@src/components/layout/blocks/DetailTabStrip";
import { SideChatHeaderHost } from "@src/engines/ChatPanel/SideChat/SideChatHeaderHost";
import { HugeiconsIcon, Link02Icon, MessageMultiple01Icon } from "@src/icons";

export type ThreadDetailTab = "conversation" | "linked";

interface ThreadDetailTabsProps {
  activeTab: ThreadDetailTab;
  conversationCount?: number;
  conversationCountLoading?: boolean;
  linkedCount?: number;
  linkedCountLoading?: boolean;
  onChange?: (tab: ThreadDetailTab) => void;
  trailing?: ReactNode;
  variant?: "row" | "header";
  idPrefix: string;
  ariaLabel?: string;
  className?: string;
}

/** Shared PR-format navigation for Work Item and GitHub issue details. */
export default function ThreadDetailTabs({
  activeTab,
  conversationCount,
  conversationCountLoading = false,
  linkedCount,
  linkedCountLoading = false,
  onChange,
  trailing,
  variant,
  idPrefix,
  ariaLabel,
  className,
}: ThreadDetailTabsProps) {
  const { t } = useTranslation("common");

  return (
    <DetailTabStrip<ThreadDetailTab>
      activeTab={activeTab}
      ariaLabel={
        ariaLabel ?? t("git.issues.detailNavigation", "Issue navigation")
      }
      idPrefix={idPrefix}
      tabs={[
        {
          key: "conversation",
          label: t("git.pr.tabs.conversation", "Conversation"),
          icon: (
            <HugeiconsIcon
              icon={MessageMultiple01Icon}
              data-icon="messages-square"
              size={15}
              strokeWidth={1.8}
            />
          ),
          count: conversationCount,
          countLoading: conversationCountLoading,
          disabled: !onChange,
        },
        {
          key: "linked",
          label: t("git.issues.tabs.relatedItems", "Related items"),
          icon: (
            <HugeiconsIcon
              icon={Link02Icon}
              data-icon="link-2"
              size={15}
              strokeWidth={1.8}
            />
          ),
          count: linkedCount,
          countLoading: linkedCountLoading,
          disabled: !onChange,
        },
      ]}
      onChange={(tab) => onChange?.(tab)}
      trailing={
        <>
          <SideChatHeaderHost />
          {trailing}
        </>
      }
      variant={variant}
      className={className}
    />
  );
}
