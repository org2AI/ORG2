/**
 * Icon-only shortcut column shown by the collapsed 44px focused-chat
 * workstation rail. Each item keeps its label and CI status in a tooltip and
 * a status dot instead of a labelled row.
 */
import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";

import { resolveRailStatusDotClass } from "./railStorage";
import type { FocusedChatRailItem } from "./types";

export function WorkstationCollapsedRailItems({
  items,
}: {
  items: FocusedChatRailItem[];
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      {items.map((item) => {
        const icon = item.icon;
        return (
          <ToolbarTooltip
            key={item.key}
            label={item.status?.title ?? item.label}
            shortcut={item.shortcut}
            shortcutId={item.shortcutId}
            position="left"
          >
            <Button
              size="small"
              variant="tertiary"
              iconOnly
              className="relative"
              onClick={item.onClick}
              aria-label={
                item.status ? `${item.label}, ${item.status.label}` : item.label
              }
              icon={
                <>
                  <AnyIcon icon={icon} size={16} strokeWidth={1.75} />
                  {item.status ? (
                    <span
                      aria-hidden
                      className={`absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full ring-1 ring-bg-1 ${resolveRailStatusDotClass(
                        item.status.state
                      )}`}
                    />
                  ) : null}
                </>
              }
            />
          </ToolbarTooltip>
        );
      })}
    </div>
  );
}
