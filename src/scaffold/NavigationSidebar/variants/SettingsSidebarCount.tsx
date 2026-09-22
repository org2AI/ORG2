import { atom, useAtomValue } from "jotai";

import {
  availableAppUpdateAtom,
  mockAppUpdateEnabledAtom,
} from "@src/scaffold/AppUpdater/state";

// Add future mock flags here so the badge counts every enabled scenario.
const enabledMockCountAtom = atom((get) =>
  Number(get(mockAppUpdateEnabledAtom))
);
const availableUpdateCountAtom = atom((get) =>
  Number(Boolean(get(availableAppUpdateAtom)?.available))
);

export default function SettingsSidebarCount({
  section,
}: {
  section: "general" | "development";
}) {
  const count = useAtomValue(
    section === "development" ? enabledMockCountAtom : availableUpdateCountAtom
  );
  if (count === 0) return null;
  return (
    <span
      data-testid={`settings-${section}-count`}
      className="inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-primary-6 px-1 text-[9px] leading-none font-medium text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
