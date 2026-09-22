/**
 * Commit-side primary actions of `CommitControls`: the merge-continue
 * button, the inline action row shown next to the message input, or the
 * commit button (with a dropdown for the advanced variants when any is
 * wired) shown in the sidebar.
 */
import { useCallback, useState } from "react";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import Menu from "@src/components/Menu";
import SplitButton from "@src/components/SplitButton";
import { HugeiconsIcon, Tick01Icon } from "@src/icons";

import { SHORTCUTS } from "../../../hooks/useSourceControlShortcuts";
import { GIT_LABELS } from "../config";

export interface CommitActionButtonsProps {
  canCommit: boolean;
  commitButtonText: string;
  commitLoading: boolean;
  hasStagedFiles: boolean;
  hasUnresolvedConflicts: boolean;
  hasUnstagedFiles: boolean;
  isMerging: boolean;
  onAmend?: () => void;
  onCommit: () => void;
  onCommitAndPublish?: () => void;
  onCommitAndPush?: () => void;
  onCommitAndSync?: () => void;
  onContinueMerge?: () => void;
  publishLoading: boolean;
  showMessage: boolean;
}

export function CommitActionButtons({
  canCommit,
  commitButtonText,
  commitLoading,
  hasStagedFiles,
  hasUnresolvedConflicts,
  hasUnstagedFiles,
  isMerging,
  onAmend,
  onCommit,
  onCommitAndPublish,
  onCommitAndPush,
  onCommitAndSync,
  onContinueMerge,
  publishLoading,
  showMessage,
}: CommitActionButtonsProps) {
  // State for dropdown visibility
  const [dropdownVisible, setDropdownVisible] = useState(false);

  // Check if any advanced actions are available
  const hasAdvancedActions =
    !isMerging &&
    (onCommitAndPush || onCommitAndPublish || onCommitAndSync || onAmend);

  // Handle menu item click
  const handleMenuClick = useCallback((action: () => void) => {
    setDropdownVisible(false);
    action();
  }, []);

  const commitTitle =
    !hasStagedFiles && hasUnstagedFiles
      ? `No staged changes. Will stage all changes and commit (Smart Commit)\n\nShortcut: ${SHORTCUTS.commit}`
      : `Commit changes\n\nShortcut: ${SHORTCUTS.commit}`;

  // Merge Continue Button
  if (isMerging) {
    return (
      <Button
        variant="primary"
        size="small"
        className="w-full"
        onClick={onContinueMerge || onCommit}
        disabled={!canCommit}
        loading={commitLoading}
        title={
          hasUnresolvedConflicts
            ? "Resolve all conflicts before completing the merge"
            : "Complete merge"
        }
        data-action="git.commit"
        icon={<HugeiconsIcon icon={Tick01Icon} data-icon="check" size={14} />}
      >
        {commitButtonText}
      </Button>
    );
  }

  if (showMessage) {
    return (
      <div className="flex flex-wrap gap-2">
        {[
          {
            label: commitButtonText,
            action: onCommit,
            id: "git.commit",
            primary: true,
          },
          {
            label: GIT_LABELS.commitAmend,
            action: onAmend,
            id: "git.commit.amend",
          },
          {
            label: GIT_LABELS.commitAndPush,
            action: onCommitAndPush,
            id: "git.commit.push",
          },
          {
            label: GIT_LABELS.commitAndPublish,
            action: onCommitAndPublish,
            id: "git.commit.publish",
          },
          {
            label: GIT_LABELS.commitAndSync,
            action: onCommitAndSync,
            id: "git.commit.sync",
          },
        ]
          .filter(({ action }) => action)
          .map(({ label, action, id, primary }) => (
            <Button
              key={id}
              variant={primary ? "primary" : "secondary"}
              size="small"
              onClick={action}
              disabled={!canCommit || commitLoading || publishLoading}
              loading={primary && commitLoading}
              data-action={id}
            >
              {label}
            </Button>
          ))}
      </div>
    );
  }

  if (hasAdvancedActions) {
    /* Commit button with dropdown */
    return (
      <SplitButton
        variant="primary"
        size="small"
        className="w-full"
        onClick={onCommit}
        disabled={!canCommit}
        loading={commitLoading}
        title={commitTitle}
        data-action="git.commit"
        menu={
          <Dropdown
            droplist={
              <Menu>
                <Menu.Item
                  key="commit"
                  onClick={() => handleMenuClick(onCommit)}
                >
                  {GIT_LABELS.commit}
                </Menu.Item>
                {onAmend && (
                  <Menu.Item
                    key="amend"
                    onClick={() => handleMenuClick(onAmend)}
                  >
                    {GIT_LABELS.commitAmend}
                  </Menu.Item>
                )}
                {onCommitAndPush && (
                  <Menu.Item
                    key="commit-push"
                    onClick={() => handleMenuClick(onCommitAndPush)}
                  >
                    {GIT_LABELS.commitAndPush}
                  </Menu.Item>
                )}
                {onCommitAndPublish && (
                  <Menu.Item
                    key="commit-publish"
                    onClick={() => handleMenuClick(onCommitAndPublish)}
                  >
                    {GIT_LABELS.commitAndPublish}
                  </Menu.Item>
                )}
                {onCommitAndSync && (
                  <Menu.Item
                    key="commit-sync"
                    onClick={() => handleMenuClick(onCommitAndSync)}
                  >
                    {GIT_LABELS.commitAndSync}
                  </Menu.Item>
                )}
              </Menu>
            }
            trigger="click"
            position="bottom-end"
            popupVisible={dropdownVisible}
            onVisibleChange={setDropdownVisible}
          >
            <div />
          </Dropdown>
        }
        onMenuButtonClick={(event) => {
          event.stopPropagation();
          setDropdownVisible(!dropdownVisible);
        }}
        menuOpen={dropdownVisible}
        menuButtonLabel={commitButtonText}
        contentAlignment="whole"
      >
        {commitButtonText}
      </SplitButton>
    );
  }

  /* Simple Commit Button */
  return (
    <Button
      variant="primary"
      size="small"
      className="w-full"
      onClick={onCommit}
      disabled={!canCommit}
      loading={commitLoading}
      title={commitTitle}
      data-action="git.commit"
    >
      {commitButtonText}
    </Button>
  );
}
