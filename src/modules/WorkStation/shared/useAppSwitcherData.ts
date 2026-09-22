/**
 * App switcher data hooks
 *
 * Returns the props needed to render an {@link AppSwitcherChip} for the
 * Agent Station (dock-driven apps) surface via {@link useSimulatorAppSwitcher}.
 *
 * View component lives in `AppSwitcherChip.tsx`. Data + view are split so the
 * chip can render identically without any conditional branching at the view
 * layer.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ROUTES } from "@src/config/routes";
import { replayModeAtom } from "@src/engines/SessionCore";
import {
  DOCK_APPS,
  getSimulatorDockTitleCenter,
} from "@src/engines/Simulator/components/Dock";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { CodeXmlIcon, type IconSvgElement } from "@src/icons";
import {
  simulatorEffectiveDockAppAtom,
  simulatorSelectedAppAtom,
} from "@src/store/ui/simulatorAtom";
import { revealMyStation } from "@src/util/ui/revealMyStation";

import type { AppSwitcherMenuItem } from "./AppSwitcherDropdownPanel";

export interface AppSwitcherChipData {
  icon: IconSvgElement;
  label: string;
  activeId: string;
  items: AppSwitcherMenuItem[];
  onSelect: (id: string) => void;
}

// ============================================
// Agent Station (dock-driven)
// ============================================

export function useSimulatorAppSwitcher(): AppSwitcherChipData {
  const { t: tNav } = useTranslation("navigation");
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);
  const setSelectedApp = useSetAtom(simulatorSelectedAppAtom);
  const setReplayMode = useSetAtom(replayModeAtom);

  const titleCenter = useMemo(
    () => getSimulatorDockTitleCenter(effectiveDockApp, tNav),
    [effectiveDockApp, tNav]
  );

  const items = useMemo<AppSwitcherMenuItem[]>(
    () =>
      DOCK_APPS.map((app) => {
        const tc = getSimulatorDockTitleCenter(app.id as AppType, tNav);
        return {
          id: app.id,
          icon: tc.icon ?? app.icon,
          label: tc.label,
        };
      }),
    [tNav]
  );

  const onSelect = useCallback(
    (appId: string) => {
      // Browser in Agent Station switches to My Station Browser (real webview).
      // The Simulator Browser is session-replay only and has no live webview.
      if (appId === AppType.BROWSER) {
        revealMyStation({ path: ROUTES.workStation.browser.path });
        return;
      }
      setSelectedApp(appId as AppType);
      setReplayMode("replay");
    },
    [setReplayMode, setSelectedApp]
  );

  return {
    icon: titleCenter.icon ?? CodeXmlIcon,
    label: titleCenter.label ?? "",
    activeId: effectiveDockApp ?? "",
    items,
    onSelect,
  };
}
