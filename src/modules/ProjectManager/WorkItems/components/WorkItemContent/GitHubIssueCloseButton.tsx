import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { DropdownItem, DropdownSearch } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import SplitButton from "@src/components/SplitButton";
import { getDropdownPanelStyle, useDropdownEngine } from "@src/hooks/dropdown";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CircleDotIcon,
  CircleSlashIcon,
  Copy01Icon,
  HugeiconsIcon,
  Loading03Icon,
} from "@src/icons";

import type {
  GitHubIssueInteractionConfig,
  GitHubIssueStatusChangeOptions,
} from "./types";

interface GitHubIssueCloseButtonProps {
  interaction: GitHubIssueInteractionConfig;
  onStatusChange: (
    state: GitHubIssueInteractionConfig["issueState"],
    options?: GitHubIssueStatusChangeOptions
  ) => Promise<void>;
}

type CloseMenuLevel = "actions" | "duplicate";

const GitHubIssueCloseButton: React.FC<GitHubIssueCloseButtonProps> = ({
  interaction,
  onStatusChange,
}) => {
  const { t } = useTranslation("common");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menuLevel, setMenuLevel] = useState<CloseMenuLevel>("actions");
  const [searchQuery, setSearchQuery] = useState("");
  const busy = interaction.updatingStatus || interaction.submittingComment;
  const disabled = busy || interaction.updatingBody;

  // Anchored on the split button's own DOM node (not a zero-width proxy)
  // so the panel can actually left-align with the button it opens from.
  const {
    isOpen: menuVisible,
    isPositioned,
    toggle: toggleMenu,
    close: closeMenu,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    anchorRef,
    align: "left",
    onOpenChange: (open) => {
      if (!open) {
        setMenuLevel("actions");
        setSearchQuery("");
      }
    },
  });

  const filteredCandidates = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return interaction.duplicateCandidates;
    return interaction.duplicateCandidates.filter(
      (candidate) =>
        candidate.title.toLocaleLowerCase().includes(query) ||
        String(candidate.number).includes(query.replace(/^#/, ""))
    );
  }, [interaction.duplicateCandidates, searchQuery]);

  const openDuplicateLevel = () => {
    setMenuLevel("duplicate");
    if (
      !interaction.duplicateCandidatesLoaded &&
      !interaction.loadingDuplicateCandidates
    ) {
      void interaction.onLoadDuplicateCandidates().catch(() => undefined);
    }
  };

  const selectStatus = (
    options: GitHubIssueStatusChangeOptions = { stateReason: "completed" }
  ) => {
    closeMenu();
    void onStatusChange("closed", options);
  };

  const duplicatePanel = (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.fileTreeClass}`}
      data-testid="github-issue-duplicate-picker"
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        layout="custom"
        className={`${DROPDOWN_CLASSES.menuActionItem} rounded-none border-b border-border-2`}
        onClick={() => {
          setMenuLevel("actions");
          setSearchQuery("");
        }}
        data-testid="github-issue-duplicate-picker-back"
      >
        <HugeiconsIcon
          icon={ArrowLeft01Icon}
          data-icon="chevron-left"
          size={DROPDOWN_ITEM.iconSize}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {t("git.issues.composer.closeAsDuplicate")}
        </span>
      </Button>
      <DropdownSearch
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={t("git.issues.composer.duplicateSearchPlaceholder")}
        ariaLabel={t("git.issues.composer.duplicateSearchPlaceholder")}
        autoFocus
      />
      {interaction.loadingDuplicateCandidates ? (
        <div
          className={DROPDOWN_CLASSES.listMessage}
          data-testid="github-issue-duplicate-loading"
        >
          <HugeiconsIcon
            icon={Loading03Icon}
            data-icon="loader-2"
            size={DROPDOWN_ITEM.iconSize}
            className="animate-spin"
            aria-hidden
          />
          <span>{t("actions.loading")}</span>
        </div>
      ) : interaction.duplicateCandidatesError ? (
        <div className={DROPDOWN_CLASSES.listMessage} role="status">
          {t("git.issues.composer.duplicateLoadFailed")}
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className={DROPDOWN_CLASSES.listMessage}>
          {t("git.issues.composer.duplicateEmpty")}
        </div>
      ) : (
        <div className={DROPDOWN_CLASSES.optionsContainerScrollbar}>
          <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
            {filteredCandidates.map((candidate) => (
              <DropdownItem
                key={candidate.id}
                icon={
                  candidate.state === "open" ? (
                    <HugeiconsIcon
                      icon={CircleDotIcon}
                      data-icon="circle-dot"
                      size={DROPDOWN_ITEM.iconSize}
                      aria-hidden
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      data-icon="check-circle-2"
                      size={DROPDOWN_ITEM.iconSize}
                      aria-hidden
                    />
                  )
                }
                onClick={() =>
                  selectStatus({
                    stateReason: "duplicate",
                    duplicateIssueId: candidate.id,
                  })
                }
                dataTestId={`github-issue-duplicate-candidate-${candidate.number}`}
              >
                <span className="min-w-0 truncate">
                  <span className="mr-1.5 text-text-3">
                    #{candidate.number}
                  </span>
                  {candidate.title}
                </span>
              </DropdownItem>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const actionsPanel = (
    <div
      className={DROPDOWN_CLASSES.menuPanel}
      data-testid="github-issue-close-menu"
      onClick={(event) => event.stopPropagation()}
    >
      <div className={DROPDOWN_CLASSES.itemsColumn}>
        <DropdownItem
          icon={
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              data-icon="check-circle-2"
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden
            />
          }
          onClick={() => selectStatus({ stateReason: "completed" })}
          dataTestId="github-issue-close-completed"
        >
          {t("git.issues.composer.closeAsCompleted")}
        </DropdownItem>
        <DropdownItem
          icon={
            <HugeiconsIcon
              icon={CircleSlashIcon}
              data-icon="circle-slash"
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden
            />
          }
          onClick={() => selectStatus({ stateReason: "not_planned" })}
          dataTestId="github-issue-close-not-planned"
        >
          {t("git.issues.composer.closeAsNotPlanned")}
        </DropdownItem>
        <DropdownItem
          icon={
            <HugeiconsIcon
              icon={Copy01Icon}
              data-icon="copy"
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden
            />
          }
          suffix={
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={DROPDOWN_ITEM.iconSize}
              aria-hidden
            />
          }
          onClick={openDuplicateLevel}
          dataTestId="github-issue-close-duplicate"
        >
          {t("git.issues.composer.closeAsDuplicate")}
        </DropdownItem>
      </div>
    </div>
  );

  if (interaction.issueState === "closed") {
    return (
      <Button
        shape="round"
        icon={
          <HugeiconsIcon
            icon={CircleDotIcon}
            data-icon="circle-dot"
            size={14}
            aria-hidden
          />
        }
        loading={busy}
        disabled={disabled}
        onClick={() => void onStatusChange("open")}
        data-testid="github-issue-comment-status-action"
      >
        {t("git.issues.composer.reopenIssue")}
      </Button>
    );
  }

  return (
    <SplitButton
      ref={anchorRef}
      shape="round"
      icon={
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          data-icon="check-circle-2"
          size={14}
          aria-hidden
        />
      }
      loading={busy}
      disabled={disabled}
      onClick={() => selectStatus({ stateReason: "completed" })}
      menu={
        isPositioned
          ? createPortal(
              <div
                ref={panelRef}
                className={DROPDOWN_PANEL.zIndexClass}
                style={{
                  position: "fixed",
                  ...getDropdownPanelStyle(panelPosition, {
                    widthMode: "none",
                  }),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {menuLevel === "duplicate" ? duplicatePanel : actionsPanel}
              </div>,
              document.body
            )
          : null
      }
      onMenuButtonClick={(event) => {
        event.stopPropagation();
        toggleMenu();
      }}
      menuOpen={menuVisible}
      menuButtonLabel={t("git.issues.composer.closeIssue")}
      widthMode="hug"
      menuSegmentWidth={28}
      data-testid="github-issue-comment-status-action"
    >
      {t("git.issues.composer.closeIssue")}
    </SplitButton>
  );
};

export default GitHubIssueCloseButton;
