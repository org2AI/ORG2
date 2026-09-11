import { useAtom } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { spotlightCommandViewAtom } from "@src/store/ui/spotlightCommandViewAtom";

import { PaletteBody, type PaletteBodyProps } from "../shell/PaletteBody";
import { ShellFooterAction } from "../shell/ShellFooterAction";
import { SpotlightCardList } from "./SpotlightCardList";

/** Presentation belongs to the command list, independent of agent launch mode. */
export function SpotlightCommandView(props: PaletteBodyProps) {
  const { t } = useTranslation();
  const [view, setView] = useAtom(spotlightCommandViewAtom);
  const { kernel, items } = props;
  return (
    <>
      <PaletteBody
        {...props}
        path={view === "gui" ? [] : props.path}
        contentOverride={
          view === "gui" ? (
            <SpotlightCardList
              items={items}
              selectedIndex={kernel.selectedIndex}
              onItemSelect={kernel.handleItemClick}
              onItemHover={kernel.setSelectedIndex}
              searchQuery={kernel.searchQuery}
              containerHeight={props.containerHeight ?? 400}
            />
          ) : undefined
        }
      />
      <ShellFooterAction placement="inline">
        <SegmentedTextPill
          ariaLabel={t("actions.view")}
          size="small"
          value={view}
          options={[
            { value: "gui", label: "GUI" },
            { value: "tui", label: "TUI" },
          ]}
          onChange={(nextView) => {
            setView(nextView);
            kernel.inputRef.current?.focus();
          }}
        />
      </ShellFooterAction>
    </>
  );
}
