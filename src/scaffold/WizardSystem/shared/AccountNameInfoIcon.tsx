import { useTranslation } from "react-i18next";

import Tooltip from "@src/components/Tooltip";
import { HugeiconsIcon, InformationCircleIcon } from "@src/icons";

export function AccountNameInfoIcon({ provider }: { provider: string }) {
  const { t } = useTranslation("integrations");

  return (
    <Tooltip
      content={
        <div className="max-w-[280px]">
          {t("keyVault.accountNameDesc", { provider })}
        </div>
      }
      position="top"
      mouseEnterDelay={200}
    >
      <span className="inline-flex shrink-0 cursor-help text-text-3 hover:text-text-2">
        <HugeiconsIcon
          icon={InformationCircleIcon}
          data-icon="info"
          size={14}
        />
      </span>
    </Tooltip>
  );
}
