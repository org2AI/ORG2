/**
 * Sync Changes control of `CommitControls`: a push / pull / sync primary
 * action chosen from the ahead-behind counts, with a dropdown for the
 * individual Pull, Push and Fetch operations when they are wired.
 */
import React, { useCallback, useState } from "react";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import Menu from "@src/components/Menu";
import SplitButton from "@src/components/SplitButton";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  HugeiconsIcon,
  Refresh04Icon,
} from "@src/icons";

import { GIT_LABELS, formatCommitCount } from "../config";

export interface CommitSyncControlProps {
  ahead: number;
  behind: number;
  fetchLoading: boolean;
  onFetch?: () => void;
  onPull?: () => void;
  onPush?: () => void;
  onSync?: () => void;
  pullLoading: boolean;
  pushLoading: boolean;
  syncLoading: boolean;
}

export function CommitSyncControl({
  ahead,
  behind,
  fetchLoading,
  onFetch,
  onPull,
  onPush,
  onSync,
  pullLoading,
  pushLoading,
  syncLoading,
}: CommitSyncControlProps) {
  const [syncDropdownVisible, setSyncDropdownVisible] = useState(false);

  // Check if sync dropdown has individual actions available
  const hasSyncActions = onPull || onPush || onFetch;

  // Whether any sync-area operation is loading
  const anySyncLoading =
    syncLoading || pullLoading || pushLoading || fetchLoading;

  // Sync only makes sense when both ahead AND behind
  const hasBothDirections = ahead > 0 && behind > 0;

  // Primary action: push-only, pull-only, or full sync
  const primarySyncAction = hasBothDirections
    ? onSync
    : ahead > 0
      ? (onPush ?? onSync)
      : (onPull ?? onSync);

  // Handle sync menu item click
  const handleSyncMenuClick = useCallback((action: () => void) => {
    setSyncDropdownVisible(false);
    action();
  }, []);

  // Build sync button label based on ahead/behind state
  const getSyncLabel = () => {
    if (pullLoading) {
      return <span className="font-medium">{GIT_LABELS.pulling}</span>;
    }
    if (pushLoading) {
      return <span className="font-medium">{GIT_LABELS.pushing}</span>;
    }
    if (fetchLoading) {
      return <span className="font-medium">{GIT_LABELS.fetching}</span>;
    }
    if (syncLoading) {
      return <span className="font-medium">{GIT_LABELS.syncing}</span>;
    }

    const parts: React.ReactNode[] = [];

    if (hasBothDirections) {
      parts.push(
        <HugeiconsIcon
          icon={Refresh04Icon}
          data-icon="refresh-cw"
          size={14}
          className="mr-1.5"
          key="icon"
        />
      );
      parts.push(<span key="text">{GIT_LABELS.syncChanges}</span>);
      parts.push(
        <span key="behind" className="ml-1.5 flex items-center">
          {behind}
          <HugeiconsIcon
            icon={ArrowDown02Icon}
            data-icon="arrow-down"
            size={12}
            className="ml-0.5"
          />
        </span>
      );
      parts.push(
        <span key="ahead" className="ml-1.5 flex items-center">
          {ahead}
          <HugeiconsIcon
            icon={ArrowUp02Icon}
            data-icon="arrow-up"
            size={12}
            className="ml-0.5"
          />
        </span>
      );
    } else if (ahead > 0) {
      parts.push(
        <HugeiconsIcon
          icon={ArrowUp02Icon}
          data-icon="arrow-up"
          size={14}
          className="mr-1.5"
          key="icon"
        />
      );
      parts.push(<span key="text">{formatCommitCount("Push", ahead)}</span>);
    } else if (behind > 0) {
      parts.push(
        <HugeiconsIcon
          icon={ArrowDown02Icon}
          data-icon="arrow-down"
          size={14}
          className="mr-1.5"
          key="icon"
        />
      );
      parts.push(<span key="text">{formatCommitCount("Pull", behind)}</span>);
    }

    return <span className="flex items-center justify-center">{parts}</span>;
  };

  const title = hasBothDirections
    ? GIT_LABELS.syncChanges
    : ahead > 0
      ? formatCommitCount("Push", ahead)
      : formatCommitCount("Pull", behind);

  if (!hasSyncActions) {
    return (
      <Button
        variant="primary"
        size="small"
        className="w-full"
        onClick={primarySyncAction}
        disabled={anySyncLoading}
        loading={anySyncLoading}
        title={title}
        data-action="git.sync"
      >
        {getSyncLabel()}
      </Button>
    );
  }

  return (
    <SplitButton
      variant="primary"
      size="small"
      className="w-full"
      onClick={primarySyncAction}
      disabled={anySyncLoading}
      loading={anySyncLoading}
      title={title}
      data-action="git.sync"
      menu={
        <Dropdown
          droplist={
            <Menu>
              {hasBothDirections && onSync && (
                <Menu.Item
                  key="sync"
                  onClick={() => handleSyncMenuClick(onSync)}
                >
                  {GIT_LABELS.syncChanges}
                </Menu.Item>
              )}
              {onPull && (
                <Menu.Item
                  key="pull"
                  onClick={() => handleSyncMenuClick(onPull)}
                >
                  {GIT_LABELS.pull}
                  {behind > 0 && (
                    <span className="ml-1.5 text-text-3">
                      {behind}
                      <HugeiconsIcon
                        icon={ArrowDown02Icon}
                        data-icon="arrow-down"
                        size={10}
                        className="ml-0.5 inline"
                      />
                    </span>
                  )}
                </Menu.Item>
              )}
              {onPush && (
                <Menu.Item
                  key="push"
                  onClick={() => handleSyncMenuClick(onPush)}
                >
                  {GIT_LABELS.push}
                  {ahead > 0 && (
                    <span className="ml-1.5 text-text-3">
                      {ahead}
                      <HugeiconsIcon
                        icon={ArrowUp02Icon}
                        data-icon="arrow-up"
                        size={10}
                        className="ml-0.5 inline"
                      />
                    </span>
                  )}
                </Menu.Item>
              )}
              {onFetch && (
                <Menu.Item
                  key="fetch"
                  onClick={() => handleSyncMenuClick(onFetch)}
                >
                  {GIT_LABELS.fetch}
                </Menu.Item>
              )}
            </Menu>
          }
          trigger="click"
          position="bottom-end"
          popupVisible={syncDropdownVisible}
          onVisibleChange={setSyncDropdownVisible}
        >
          <div />
        </Dropdown>
      }
      onMenuButtonClick={(event) => {
        event.stopPropagation();
        setSyncDropdownVisible(!syncDropdownVisible);
      }}
      menuOpen={syncDropdownVisible}
      menuButtonLabel={GIT_LABELS.syncChanges}
    >
      {getSyncLabel()}
    </SplitButton>
  );
}
