import { useAtom } from "jotai";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PanelHeader, {
  PANEL_HEADER_TOKENS,
} from "@src/components/layout/blocks/PanelHeader";
import { Cancel01Icon, ComputerIcon, HugeiconsIcon } from "@src/icons";
import { VerticalResizeHandle, useColumnResize } from "@src/scaffold/Resize";
import { chatPanelCompanionAtom } from "@src/store/chatPanel/chatPanelCompanionAtom";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";

import { openSessionSources } from "./sessionSources/openSessionSources";

const SessionSourcesContent = React.lazy(() =>
  import("@src/features/SessionSources/SessionSourcesContent").then(
    (module) => ({
      default: module.SessionSourcesContent,
    })
  )
);

// Preferred reading width; the CSS cap always leaves at least half for chat.
const COMPANION_WIDTH = { initial: 420, min: 240, max: 720 };

function SourcesCompanion({
  topInset,
  sessionId,
  onClose,
}: {
  topInset: number;
  sessionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(COMPANION_WIDTH.initial);
  const { columnRef, handleMouseDown, isResizing } = useColumnResize({
    width,
    setWidth,
    min: COMPANION_WIDTH.min,
    max: COMPANION_WIDTH.max,
    inverted: true,
  });
  const title = t("common:git.rail.sources");
  const closeLabel = t("common:actions.close");
  const stationLabel = t("sessions:chat.moveToWorkstation");
  return (
    <>
      <div className="flex shrink-0" style={{ marginTop: topInset }}>
        <VerticalResizeHandle
          onMouseDown={handleMouseDown}
          isResizing={isResizing}
        />
      </div>
      <div
        ref={columnRef}
        role="complementary"
        aria-label={title}
        data-testid="chat-panel-companion"
        className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-chat-pane"
        style={{ width, maxWidth: "50%", marginTop: topInset }}
      >
        <PanelHeader
          title={title}
          borderBottom
          actions={
            <>
              <Button
                {...PANEL_HEADER_TOKENS.actionButton}
                title={stationLabel}
                aria-label={stationLabel}
                icon={
                  <HugeiconsIcon
                    icon={ComputerIcon}
                    size={PANEL_HEADER_TOKENS.buttonIconSize}
                  />
                }
                onClick={() => {
                  openSessionSources(sessionId, title, "my-station");
                  onClose();
                }}
              />
              <Button
                {...PANEL_HEADER_TOKENS.actionButton}
                title={closeLabel}
                aria-label={closeLabel}
                icon={
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={PANEL_HEADER_TOKENS.buttonIconSize}
                  />
                }
                onClick={onClose}
              />
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <React.Suspense
            fallback={
              <p role="status" className="p-4 text-sm text-text-3">
                {t("common:status.loading")}
              </p>
            }
          >
            <SessionSourcesContent sessionId={sessionId} />
          </React.Suspense>
        </div>
      </div>
    </>
  );
}

/** Keep the chat subtree stable while swapping its summary rail for companion content. */
export function ChatPanelCompanionLayout({
  activeTab,
  topInset = 0,
  children,
  rail,
}: React.PropsWithChildren<{
  activeTab: ChatPanelTab | null;
  topInset?: number;
  rail?: React.ReactNode;
}>) {
  const [companion, setCompanion] = useAtom(chatPanelCompanionAtom);
  const visible =
    companion !== null &&
    activeTab?.type === "session" &&
    activeTab.id === companion.ownerTabId &&
    activeTab.sessionId === companion.sessionId;

  // Navigation closes transient content. The render gate hides stale content
  // immediately, before this cleanup runs; late source reads cannot cross owners.
  useEffect(() => {
    if (companion && !visible) setCompanion(null);
  }, [companion, visible, setCompanion]);
  useEffect(() => () => setCompanion(null), [setCompanion]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="chat-panel-split">
      <div className="@container/focusedchat flex min-h-0 min-w-0 flex-1">
        {children}
      </div>
      {visible ? (
        <SourcesCompanion
          key={companion.sessionId}
          sessionId={companion.sessionId}
          topInset={topInset}
          onClose={() => setCompanion(null)}
        />
      ) : (
        rail
      )}
    </div>
  );
}
