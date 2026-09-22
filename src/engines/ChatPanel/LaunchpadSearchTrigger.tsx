import { useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { KeyboardShortcut } from "@src/components/KeyboardShortcut";
import { HugeiconsIcon, Search01Icon } from "@src/icons";
import { launchpadTransitionSourceAtom } from "@src/scaffold/GlobalSpotlight/useLaunchpadTransition";
import {
  spotlightInitialQueryAtom,
  spotlightOpenAtom,
} from "@src/store/ui/uiAtom";

import { CHAT_PANEL_HEADER_NO_DRAG_STYLE } from "./header";

/** A command-center entry; Spotlight owns input, results, and focus. */
export function LaunchpadSearchTrigger({
  placement = "center",
}: {
  placement?: "center" | "trailing";
}) {
  const { t } = useTranslation("common");
  const setInitialQuery = useSetAtom(spotlightInitialQueryAtom);
  const setTransitionSource = useSetAtom(launchpadTransitionSourceAtom);
  const setOpen = useSetAtom(spotlightOpenAtom);

  return (
    <div
      className={
        placement === "center"
          ? "absolute top-2 bottom-0 left-1/2 z-50 hidden w-1/3 max-w-96 -translate-x-1/2 items-center @[48rem]/launchpad-header:flex"
          : "mr-1 flex shrink-0 items-center @[48rem]/launchpad-header:hidden"
      }
      style={CHAT_PANEL_HEADER_NO_DRAG_STYLE}
    >
      <Button
        size="small"
        shape="round"
        className="w-full bg-transparent! text-text-3! hover:bg-fill-2! data-[spotlight-source-active]:opacity-0 [&>span]:w-full"
        aria-label={t("actions.search")}
        aria-haspopup="dialog"
        data-testid="launchpad-spotlight-trigger"
        onClick={(event) => {
          setTransitionSource(event.currentTarget);
          setInitialQuery(null);
          setOpen(true);
        }}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.75} />
            <span
              className={
                placement === "trailing"
                  ? "hidden truncate @[32rem]/launchpad-header:inline"
                  : "truncate"
              }
            >
              {t("actions.search")}
            </span>
          </span>
          {placement === "center" && (
            <KeyboardShortcut shortcutId="toggle_spotlight" size="sm" />
          )}
        </span>
      </Button>
    </div>
  );
}
