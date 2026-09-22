import type { TFunction } from "i18next";
import React from "react";

import Button from "@src/components/Button";

import ProgressRing from "./ProgressRing";
import type { PanelPosition, RingTone } from "./contextInfoTypes";

interface ContextInfoTriggerProps {
  compact: boolean;
  cornerLabelClass: string;
  displayPct: number;
  panelPos: PanelPosition | null;
  percentage: number;
  ringTone: RingTone;
  showCornerPercent: boolean;
  t: TFunction;
  toggle: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  triggerSurfaceClass: string;
  variant: "toolbar" | "corner";
}

/** Progress-ring button that toggles the context panel: a labelled corner pill or an icon-only toolbar button. */
export const ContextInfoTrigger: React.FC<ContextInfoTriggerProps> = ({
  compact,
  cornerLabelClass,
  displayPct,
  panelPos,
  percentage,
  ringTone,
  showCornerPercent,
  t,
  toggle,
  triggerRef,
  triggerSurfaceClass,
  variant,
}) =>
  variant === "corner" ? (
    <Button
      layout="custom"
      ref={triggerRef}
      data-testid="context-info-button"
      className={`flex h-[28px] shrink-0 items-center gap-1.5 rounded-full text-text-3 transition-colors duration-200 ${triggerSurfaceClass} ${compact ? "w-[28px] justify-center px-0" : "px-2"}`}
      onClick={toggle}
      aria-label={t("contextInfo.ariaLabel")}
      aria-expanded={panelPos !== null}
    >
      <ProgressRing percentage={displayPct} tone={ringTone} />
      {!compact && showCornerPercent && (
        <span
          className={`text-[12px] leading-none tabular-nums ${cornerLabelClass}`}
        >
          {percentage.toFixed(0)}%
        </span>
      )}
    </Button>
  ) : (
    <Button
      layout="custom"
      ref={triggerRef}
      data-testid="context-info-button"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors duration-150 hover:text-text-2 ${triggerSurfaceClass}`}
      onClick={toggle}
      aria-label={t("contextInfo.ariaLabel")}
      aria-expanded={panelPos !== null}
    >
      <ProgressRing percentage={displayPct} tone={ringTone} />
    </Button>
  );
