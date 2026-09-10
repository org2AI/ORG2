import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ActionSubmenu } from "@src/components/Dropdown/ActionMenuSurface";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import { ExternalLinkIcon, HugeiconsIcon } from "@src/icons";
import { isMacOS } from "@src/util/platform/tauri";

import ApplicationIcon from "./ApplicationIcon";
import {
  type DocumentApplication,
  loadDocumentApplications,
  openDocument,
} from "./documentApplications";

function ApplicationItems({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<DocumentApplication[]>([]);
  useEffect(() => {
    if (!isMacOS()) return;
    let cancelled = false;
    void loadDocumentApplications(filePath)
      .then((result) => {
        if (!cancelled) setApps(result);
      })
      .catch(() => {
        if (!cancelled) Message.error(t("documentOpen.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, t]);

  const open = (application?: string) => {
    onClose();
    void openDocument(filePath, application).catch(() =>
      Message.error(t("documentOpen.openFailed"))
    );
  };
  return (
    <>
      {!apps.some((app) => app.isDefault) && (
        <DropdownItem role="menuitem" fullWidth onClick={() => open()}>
          {t("documentOpen.defaultApp")}
        </DropdownItem>
      )}
      {apps.map((app) => (
        <DropdownItem
          key={app.path}
          role="menuitem"
          fullWidth
          icon={<ApplicationIcon path={app.path} />}
          onClick={() => open(app.path)}
        >
          {app.isDefault
            ? t("documentOpen.appDefault", { name: app.name })
            : app.name}
        </DropdownItem>
      ))}
    </>
  );
}

export default function DocumentOpenSubmenu({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ActionSubmenu
      label={t("documentOpen.openExternally")}
      dataTestId="file-open-in-submenu"
      icon={
        <HugeiconsIcon
          icon={ExternalLinkIcon}
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.75}
          aria-hidden
        />
      }
    >
      <ApplicationItems key={filePath} filePath={filePath} onClose={onClose} />
    </ActionSubmenu>
  );
}
