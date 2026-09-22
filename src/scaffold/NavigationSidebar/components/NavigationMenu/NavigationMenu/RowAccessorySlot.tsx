import type React from "react";

interface NavigationMenuRowAccessorySlotProps {
  persistentContent?: React.ReactNode;
  hoverContent?: React.ReactNode;
  actionContent?: React.ReactNode;
  /** Bind hover transitions to a parent-row named group. */
  parentHoverGroup?: boolean;
  /**
   * Status indicator (e.g. "working" breathing dot). Rendered in the same
   * grid cell as persistentContent and fades out on hover so that hover-only
   * content (timestamps, actions) can take full visual focus.
   */
  workingIndicatorContent?: React.ReactNode;
}

export function NavigationMenuRowAccessorySlot({
  persistentContent,
  hoverContent,
  actionContent,
  workingIndicatorContent,
  parentHoverGroup = false,
}: NavigationMenuRowAccessorySlotProps): React.ReactElement | null {
  if (
    !persistentContent &&
    !hoverContent &&
    !actionContent &&
    !workingIndicatorContent
  ) {
    return null;
  }

  // Persistent content hides on hover ONLY when hover content replaces it
  // (develop's guard — otherwise it blinks out with nothing in its place);
  // parent thread rows scope the swap to the named group so a nested child's
  // anonymous `group` cannot capture it.
  const hasHoverReplacement = Boolean(hoverContent || actionContent);
  const persistentHoverClasses = !hasHoverReplacement
    ? ""
    : parentHoverGroup
      ? "group-hover/parent:pointer-events-none group-focus-within/parent:pointer-events-none group-hover/parent:opacity-0 group-focus-within/parent:opacity-0"
      : "group-hover:pointer-events-none group-focus-within:pointer-events-none group-hover:opacity-0 group-focus-within:opacity-0";
  const revealedHoverClasses = parentHoverGroup
    ? "group-hover/parent:pointer-events-auto group-focus-within/parent:pointer-events-auto group-hover/parent:max-w-44 group-focus-within/parent:max-w-44 group-hover/parent:opacity-100 group-focus-within/parent:opacity-100"
    : "group-hover:pointer-events-auto group-focus-within:pointer-events-auto group-hover:max-w-44 group-focus-within:max-w-44 group-hover:opacity-100 group-focus-within:opacity-100";
  // A 20px action in the 28px row has 4px of visible vertical inset. Pull the
  // action layer 4px into the row's px-2 padding so its right inset matches.
  const actionInsetClass = actionContent ? "-mr-1" : "";
  const hasStacked = Boolean(
    persistentContent ||
    hoverContent ||
    actionContent ||
    workingIndicatorContent
  );
  const stackedContent = hasStacked ? (
    <span className="grid items-center justify-end leading-none">
      {/* Both layers share one grid cell and must be `justify-self-end`: the
          cell is as wide as the widest layer, and a stretched item whose
          `max-width` clamps it falls back to *start* alignment, which would
          park the buttons left of where they belong.

          The hover layer still collapses to `max-w-0` at rest — reserving its
          width permanently would cost every row ~30px of label — but the swap
          carries NO transition. That is deliberate: an animated reveal reflowed
          the label on every frame (visible jitter) and, worse, left the two
          layers painted on top of each other for 150ms, so the persistent git
          glyph eclipsed the `more` button on the way in. Instant means the cell
          resizes exactly once and only one layer is ever on screen. */}
      {(persistentContent || workingIndicatorContent) && (
        <span
          className={`col-start-1 row-start-1 inline-flex items-center justify-end justify-self-end leading-none ${persistentHoverClasses}`}
        >
          {persistentContent}
          {workingIndicatorContent}
        </span>
      )}
      {(hoverContent || actionContent) && (
        <span
          className={`pointer-events-none col-start-1 row-start-1 inline-flex max-w-0 items-center justify-end gap-1.5 justify-self-end overflow-hidden whitespace-nowrap opacity-0 ${actionInsetClass} ${revealedHoverClasses}`}
        >
          {hoverContent && (
            <span className="inline-flex max-w-16 items-center justify-end overflow-hidden">
              {hoverContent}
            </span>
          )}
          {actionContent && (
            <span className="inline-flex items-center justify-end gap-px">
              {actionContent}
            </span>
          )}
        </span>
      )}
    </span>
  ) : null;

  return (
    <span className="ml-1 flex shrink-0 items-center justify-end leading-none">
      {stackedContent}
    </span>
  );
}
