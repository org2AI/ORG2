import type { TFunction } from "i18next";
import React from "react";

import Button from "@src/components/Button";
import {
  Copy01Icon,
  HugeiconsIcon,
  SquareArrowUpRight02Icon,
  Tick01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@src/icons";

interface CodeBlockHeaderActionsProps {
  copied: boolean;
  handleCopyContent: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleOpenFile: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleTogglePreview: () => void;
  isPreviewOpen: boolean;
  isPreviewable: boolean;
  shouldShowCopyButton: boolean;
  shouldShowOpenButton: boolean;
  t: TFunction<"sessions">;
}

/** Open, copy and preview-toggle buttons at the end of the header row. */
export const CodeBlockHeaderActions: React.FC<CodeBlockHeaderActionsProps> = ({
  copied,
  handleCopyContent,
  handleOpenFile,
  handleTogglePreview,
  isPreviewOpen,
  isPreviewable,
  shouldShowCopyButton,
  shouldShowOpenButton,
  t,
}) => (
  <>
    {shouldShowOpenButton && (
      <Button
        variant="tertiary"
        size="mini"
        iconOnly
        icon={
          <HugeiconsIcon
            icon={SquareArrowUpRight02Icon}
            data-icon="square-arrow-out-up-right"
            size={14}
            strokeWidth={1.75}
          />
        }
        title={t("common:actions.open")}
        aria-label={t("common:actions.open")}
        className="ml-auto shrink-0 bg-event-block hover:bg-fill-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
        onClick={handleOpenFile}
      />
    )}

    {shouldShowCopyButton && (
      <Button
        variant="tertiary"
        size="mini"
        iconOnly
        icon={
          copied ? (
            <HugeiconsIcon
              icon={Tick01Icon}
              data-icon="check"
              size={14}
              strokeWidth={1.75}
            />
          ) : (
            <HugeiconsIcon
              icon={Copy01Icon}
              data-icon="copy"
              size={14}
              strokeWidth={1.75}
            />
          )
        }
        title={copied ? t("common:status.copied") : t("common:actions.copy")}
        aria-label={
          copied ? t("common:status.copied") : t("common:actions.copy")
        }
        className={`inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-event-block p-0 text-text-3 transition-colors hover:bg-fill-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none ${
          shouldShowOpenButton ? "" : "ml-auto"
        }`}
        onClick={handleCopyContent}
      />
    )}

    {isPreviewable && (
      <Button
        layout="custom"
        onClick={(e) => {
          e.stopPropagation();
          handleTogglePreview();
        }}
        className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
          shouldShowCopyButton || shouldShowOpenButton ? "" : "ml-auto"
        } ${
          isPreviewOpen
            ? "bg-primary-6/15 text-primary-6 hover:bg-primary-6/25"
            : "text-text-4 hover:bg-fill-3 hover:text-text-2"
        }`}
        title={
          isPreviewOpen
            ? t("codePreview.hidePreview")
            : t("codePreview.showPreview")
        }
      >
        {isPreviewOpen ? (
          <HugeiconsIcon icon={ViewOffIcon} data-icon="eye-off" size={11} />
        ) : (
          <HugeiconsIcon icon={ViewIcon} data-icon="eye" size={11} />
        )}
        {t("codePreview.preview")}
      </Button>
    )}
  </>
);

interface CodeBlockFloatingToolbarProps {
  copied: boolean;
  handleCopyContent: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleOpenFile: (event: React.MouseEvent<HTMLButtonElement>) => void;
  shouldShowCopyButton: boolean;
  shouldShowOpenButton: boolean;
  t: TFunction<"sessions">;
}

/** Hover toolbar with open and copy buttons for header-less blocks. */
export const CodeBlockFloatingToolbar: React.FC<
  CodeBlockFloatingToolbarProps
> = ({
  copied,
  handleCopyContent,
  handleOpenFile,
  shouldShowCopyButton,
  shouldShowOpenButton,
  t,
}) => (
  <div className="absolute top-[16px] right-1.5 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
    <div className="flex items-center gap-1">
      {shouldShowOpenButton && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          icon={
            <HugeiconsIcon
              icon={SquareArrowUpRight02Icon}
              data-icon="square-arrow-out-up-right"
              size={14}
              strokeWidth={1.75}
            />
          }
          title={t("common:actions.open")}
          aria-label={t("common:actions.open")}
          className="bg-event-block hover:bg-fill-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
          onClick={handleOpenFile}
        />
      )}
      {shouldShowCopyButton && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          icon={
            copied ? (
              <HugeiconsIcon
                icon={Tick01Icon}
                data-icon="check"
                size={14}
                strokeWidth={1.75}
              />
            ) : (
              <HugeiconsIcon
                icon={Copy01Icon}
                data-icon="copy"
                size={14}
                strokeWidth={1.75}
              />
            )
          }
          title={copied ? t("common:status.copied") : t("common:actions.copy")}
          aria-label={
            copied ? t("common:status.copied") : t("common:actions.copy")
          }
          className="bg-event-block hover:bg-fill-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none"
          onClick={handleCopyContent}
        />
      )}
    </div>
  </div>
);
