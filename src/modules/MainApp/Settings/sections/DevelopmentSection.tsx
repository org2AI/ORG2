import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { mockAppUpdateEnabledAtom } from "@src/scaffold/AppUpdater/state";

export default function DevelopmentSection() {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useAtom(mockAppUpdateEnabledAtom);
  if (process.env.NODE_ENV !== "development") return null;

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
