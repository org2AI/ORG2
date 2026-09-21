import type { TFunction } from "i18next";
import React from "react";

import Select, { type SelectOption } from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import type { ChatPanelCreateTarget } from "@src/store/ui/chatPanel/selectionAtoms";

import type { StartPageView } from "./startPageView";

interface StartPageTabsProps {
  activeView: StartPageView;
  createTarget: ChatPanelCreateTarget;
  createTargetOptions: SelectOption[];
  onCreateTarget: (target: string) => void;
  onViewChange: (key: string) => void;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

/** Session / Work Item / More tabs, plus the create-target select on More. */
export function StartPageTabs({
  activeView,
  createTarget,
  createTargetOptions,
  onCreateTarget,
  onViewChange,
  t,
}: StartPageTabsProps): React.ReactNode {
  const selectedMoreTarget = createTargetOptions.some(
    (option) => option.value === createTarget
  )
    ? createTarget
    : createTargetOptions[0]?.value;

  return (
    <div
      className="shrink-0 bg-chat-pane"
      data-testid="chat-panel-start-page-tabs"
    >
      <div
        className={`${CHAT_PANEL_WIDTH_TOKENS.headerWidth} flex h-14 items-center justify-center gap-3 px-4 pt-1`}
      >
        <TabPill
          activeTab={activeView}
          tabs={[
            {
              key: "session",
              label: t("chat.startPage.tabs.session"),
              dataTestId: "chat-panel-start-page-tab-session",
            },
            {
              key: "work-item",
              label: t("chat.startPage.tabs.workItem"),
              dataTestId: "chat-panel-start-page-tab-work-item",
            },
            {
              key: "more",
              label: t("chat.startPage.tabs.more"),
              dataTestId: "chat-panel-start-page-tab-more",
            },
          ]}
          onChange={onViewChange}
          variant="simple"
          size="large"
          fillWidth={false}
          className="h-10"
        />
        {activeView === "more" ? (
          <div
            className="flex -translate-y-1 items-center gap-2"
            data-testid="chat-panel-start-page-trailing-control"
          >
            <span
              className="h-5 w-px shrink-0 bg-border-2"
              role="separator"
              aria-hidden
              data-testid="chat-panel-start-page-trailing-separator"
            />
            <Select
              value={selectedMoreTarget}
              options={createTargetOptions}
              onChange={(value) => {
                if (!Array.isArray(value)) {
                  onCreateTarget(String(value));
                }
              }}
              size="large"
              appearance="bare"
              radius="pill"
              dropdownMinWidth={168}
              dropdownWidthMode="auto"
              className="select-title-row w-auto"
              selectorClassName="max-w-[240px] gap-2! px-1! text-[16px]! leading-6! [&_.select-suffix]:ml-0!"
              dataTestId="chat-panel-start-page-create-target-select"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
