import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";
import { SectionContainer, SectionRow } from "@src/components/layout/Section";
import { mockAppUpdateEnabledAtom } from "@src/scaffold/AppUpdater/state";

import IllustrationPreview from "./IllustrationPreview";

export default function DevelopmentSection({
  activeTab,
}: {
  activeTab?: string;
}) {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useAtom(mockAppUpdateEnabledAtom);
  if (process.env.NODE_ENV !== "development") return null;

  if (activeTab === "illustrations") return <IllustrationPreview />;

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
