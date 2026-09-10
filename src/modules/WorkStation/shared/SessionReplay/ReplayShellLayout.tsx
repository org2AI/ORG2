import React, { type ComponentProps, memo } from "react";

import { Placeholder } from "@src/components/Placeholder";
import EventWrapper from "@src/engines/ChatPanel/adapters/EventWrapper";
import { classNames } from "@src/util/ui/classNames";

import { NoTabsPlaceholder } from "../NoTabsPlaceholder";
import type { PlaceholderIcon } from "../NoTabsPlaceholder";
import type { QuickAction } from "../QuickActionsPanel/types";
import { WorkStationShell } from "../WorkStationShell";
import type {
  PrimarySidebarConfig,
  SecondaryPanelConfig,
} from "../WorkStationShell/config";
import { SimulatorReplayChrome } from "./SimulatorReplayChrome";
import type { ReplayShellLayoutMode } from "./replayShellHelpers";

export interface ReplayShellWorkstationConfig {
  primarySidebarConfig?: PrimarySidebarConfig;
  secondaryPanelConfig?: SecondaryPanelConfig;
  statusBar?: React.ReactNode | null;
  appClassName?: string;
  layoutMode: ReplayShellLayoutMode;
}

export interface ReplayShellLayoutProps extends ComponentProps<
  typeof SimulatorReplayChrome
> {
  /** Explicit wrapper presence keeps the event subtree stable while data loads. */
  eventWrapper?: Pick<ComponentProps<typeof EventWrapper>, "event" | "mode">;
  workstation?: ReplayShellWorkstationConfig;
}

export interface ReplayShellPlaceholderProps {
  isLoading: boolean;
  icon: PlaceholderIcon;
  caption: string;
  actions: QuickAction[];
  className?: string;
}

export const ReplayShellPlaceholder: React.FC<ReplayShellPlaceholderProps> =
  memo(({ isLoading, icon, caption, actions, className }) => (
    <div className={classNames("min-h-0 flex-1", className)}>
      {isLoading ? (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      ) : (
        <NoTabsPlaceholder icon={icon} caption={caption} actions={actions} />
      )}
    </div>
  ));
ReplayShellPlaceholder.displayName = "ReplayShellPlaceholder";

const ReplayShellLayoutComponent: React.FC<ReplayShellLayoutProps> = ({
  children,
  eventWrapper,
  workstation,
  ...chromeProps
}) => {
  const body = workstation ? (
    <div className="flex min-h-0 flex-1">
      <WorkStationShell
        primarySidebarConfig={workstation.primarySidebarConfig}
        secondaryPanelConfig={workstation.secondaryPanelConfig}
        content={children}
        statusBar={workstation.statusBar ?? null}
        layoutMode={workstation.layoutMode}
        appClassName={workstation.appClassName}
      />
    </div>
  ) : (
    children
  );

  const chrome = (
    <SimulatorReplayChrome {...chromeProps}>{body}</SimulatorReplayChrome>
  );

  if (!eventWrapper) {
    return chrome;
  }

  return (
    <EventWrapper
      event={eventWrapper.event}
      mode={eventWrapper.mode}
      expand={true}
      padding="p-0"
    >
      {chrome}
    </EventWrapper>
  );
};

export const ReplayShellLayout = memo(ReplayShellLayoutComponent);
ReplayShellLayout.displayName = "ReplayShellLayout";
