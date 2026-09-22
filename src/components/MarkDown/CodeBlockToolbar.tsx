import React from "react";

import Button from "@src/components/Button";
import {
  Copy01Icon,
  HugeiconsIcon,
  SquareArrowUpRight02Icon,
  Tick01Icon,
} from "@src/icons";

export interface CodeBlockToolbarProps {
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
  pending?: boolean;
  touch?: boolean;
  openLabel?: string;
  onOpen?: () => void;
}

/** Browser-safe chrome; each shell owns clipboard and file-opening actions. */
export function CodeBlockToolbar({
  copyLabel,
  copied,
  onCopy,
  pending,
  touch,
  openLabel,
  onOpen,
}: CodeBlockToolbarProps) {
  const buttonClass = `hover:bg-fill-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none ${touch ? "h-11 w-11" : ""}`;
  return (
    <div className="code-block-toolbar" data-touch={touch || undefined}>
      {onOpen && (
        <Button
          variant="tertiary"
          size="mini"
          iconOnly
          icon={
            <HugeiconsIcon
              icon={SquareArrowUpRight02Icon}
              data-icon="square-arrow-out-up-right"
              size={touch ? 18 : 14}
              strokeWidth={1.75}
            />
          }
          title={openLabel}
          aria-label={openLabel}
          className={`code-block-open-button ${buttonClass}`}
          onClick={onOpen}
        />
      )}
      <Button
        variant="tertiary"
        size="mini"
        iconOnly
        icon={
          <HugeiconsIcon
            icon={copied ? Tick01Icon : Copy01Icon}
            data-icon={copied ? "check" : "copy"}
            size={touch ? 18 : 14}
            strokeWidth={1.75}
          />
        }
        title={copyLabel}
        aria-label={copyLabel}
        aria-busy={pending || undefined}
        disabled={pending}
        className={`code-block-copy-button ${buttonClass}`}
        onClick={onCopy}
      />
    </div>
  );
}
