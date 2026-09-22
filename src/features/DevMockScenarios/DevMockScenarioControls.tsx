/**
 * The dev mock panel's controls.
 *
 * Rendered in two places — Settings → Dev mode and the ⇧⌘D modal — so the two
 * surfaces cannot drift. Everything here is inert outside a development build;
 * the callers own the `NODE_ENV` gate that stops it mounting at all.
 */
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";
import { SectionContainer, SectionRow } from "@src/components/layout/Section";
import { mockAppUpdateEnabledAtom } from "@src/scaffold/AppUpdater/state";
import {
  DEV_MOCK_SCENARIO_IDS,
  type DevMockScenarioId,
  NEW_USER_IMPLIED_SCENARIO_IDS,
  activeDevMockScenariosAtom,
  devMockScenariosAtom,
} from "@src/store/dev/mockScenarios";

const IMPLIED_BY_NEW_USER: ReadonlySet<DevMockScenarioId> = new Set(
  NEW_USER_IMPLIED_SCENARIO_IDS
);

function UpdateAvailableRow() {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useAtom(mockAppUpdateEnabledAtom);

  return (
    <SectionContainer>
      <SectionRow
        label={t("development.updateAvailable")}
        description={t("development.updateAvailableDesc")}
      >
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          ariaLabel={t("development.updateAvailable")}
        />
      </SectionRow>
    </SectionContainer>
  );
}

function EmptyStateScenarioRows() {
  const { t } = useTranslation("settings");
  const [selection, setScenario] = useAtom(devMockScenariosAtom);
  const active = useAtomValue(activeDevMockScenariosAtom);

  return (
    <SectionContainer title={t("development.emptyStates")}>
      {DEV_MOCK_SCENARIO_IDS.map((id) => {
        const implied = IMPLIED_BY_NEW_USER.has(id);
        // `newUser` forces the rows it implies on, so lock them while it runs
        // rather than letting a switch show a position it cannot leave.
        const lockedByNewUser = implied && selection.newUser;
        const label = t(`development.scenario.${id}`);
        return (
          <SectionRow
            key={id}
            indent={implied}
            label={label}
            description={t(`development.scenario.${id}Desc`)}
          >
            <Switch
              checked={active[id]}
              disabled={lockedByNewUser}
              onCheckedChange={(enabled) => setScenario({ id, enabled })}
              ariaLabel={label}
            />
          </SectionRow>
        );
      })}
    </SectionContainer>
  );
}

export default function DevMockScenarioControls() {
  return (
    <>
      <UpdateAvailableRow />
      <EmptyStateScenarioRows />
    </>
  );
}
