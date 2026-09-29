import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";

import { FloatingLauncher } from "@src/components/FloatingWindow/FloatingLauncher";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { NoDragRegion } from "@src/components/WindowChrome";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  HugeiconsIcon,
  MinusSignIcon,
  PanelRightIcon,
  PictureInPicture01Icon,
} from "@src/icons";
import {
  collapseWorkstationAtom,
  dockWorkstationAtom,
  expandWorkstationAtom,
  floatWorkstationAtom,
  workstationPresentationAtom,
} from "@src/store/workstation/presentationAtoms";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

/** Entry shared by My Station and Agent Station, excluding detached windows. */
export function WorkstationFloatButton() {
  const { t } = useTranslation("sessions");
  const presentation = useAtomValue(workstationPresentationAtom);
  const float = useSetAtom(floatWorkstationAtom);
  if (isStationWindow() || presentation !== "docked") return null;
  return (
    <TabBarTrailingIconButton
      title={t("chat.floatWorkstation")}
      onClick={float}
      data-testid="workstation-float"
    >
      <HugeiconsIcon
        icon={PictureInPicture01Icon}
        size={HEADER_ICON_SIZE.sm}
        strokeWidth={2}
      />
    </TabBarTrailingIconButton>
  );
}

/** The floating shell owns placement; these controls only change presentation. */
export function WorkstationFloatingControls() {
  const { t } = useTranslation("sessions");
  const dock = useSetAtom(dockWorkstationAtom);
  const collapse = useSetAtom(collapseWorkstationAtom);
  return (
    <NoDragRegion className="flex shrink-0 items-center gap-px">
      <TabBarTrailingIconButton
        title={t("chat.dockWorkstation")}
        onClick={dock}
        data-testid="workstation-dock"
      >
        <HugeiconsIcon
          icon={PanelRightIcon}
          size={HEADER_ICON_SIZE.sm}
          strokeWidth={2}
        />
      </TabBarTrailingIconButton>
      <TabBarTrailingIconButton
        title={t("chat.collapseFloatingWorkstation")}
        onClick={collapse}
        data-testid="workstation-collapse"
      >
        <HugeiconsIcon
          icon={MinusSignIcon}
          size={HEADER_ICON_SIZE.sm}
          strokeWidth={2}
        />
      </TabBarTrailingIconButton>
    </NoDragRegion>
  );
}

/** Match the circular Sidechat launcher while retaining an accessible label. */
export function WorkstationFloatingLauncher() {
  const { t } = useTranslation("sessions");
  const expand = useSetAtom(expandWorkstationAtom);
  return (
    <FloatingLauncher
      onClick={expand}
      label={t("chat.expandFloatingWorkstation")}
      aria-expanded={false}
      data-testid="workstation-expand"
      icon={
        <HugeiconsIcon
          icon={PictureInPicture01Icon}
          size={HEADER_ICON_SIZE.md}
          strokeWidth={2}
        />
      }
    />
  );
}
