import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import Message from "@src/components/Message";
import { isMacOS, isTauriDesktop } from "@src/util/platform/tauri";

import {
  type DocumentApplication,
  loadDocumentApplications,
  openDocument,
} from "./documentApplications";

interface Props {
  filePath: string;
  hasUnsavedChanges: boolean;
}

function DocumentOpenMenuContent({ filePath, hasUnsavedChanges }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [apps, setApps] = useState<DocumentApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!visible || !isMacOS()) return;
    let cancelled = false;
    void loadDocumentApplications(filePath)
      .then((result) => {
        if (!cancelled) setApps(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, visible]);

  return (
    <Dropdown
      popupVisible={visible}
      onVisibleChange={(nextVisible) => {
        if (nextVisible) {
          setLoading(isMacOS());
          setFailed(false);
          setApps([]);
        }
        setVisible(nextVisible);
      }}
      options={[
        { value: "default", label: t("documentOpen.defaultApp") },
        ...apps.map((app) => ({
          value: app.path,
          label: app.isDefault
            ? t("documentOpen.appDefault", { name: app.name })
            : app.name,
        })),
        ...(loading
          ? [
              {
                value: "loading",
                label: t("documentOpen.loading"),
                disabled: true,
              },
            ]
          : []),
        ...(failed
          ? [
              {
                value: "failed",
                label: t("documentOpen.loadFailed"),
                disabled: true,
              },
            ]
          : []),
      ]}
      onSelect={(value) => {
        if (hasUnsavedChanges || opening) return;
        setVisible(false);
        setOpening(true);
        void openDocument(
          filePath,
          value === "default" ? undefined : String(value)
        )
          .catch(() => Message.error(t("documentOpen.openFailed")))
          .finally(() => setOpening(false));
      }}
      disabled={hasUnsavedChanges || opening}
    >
      <Button
        size="mini"
        disabled={hasUnsavedChanges || opening}
        title={
          hasUnsavedChanges
            ? t("documentOpen.saveFirst")
            : t("documentOpen.label")
        }
        aria-label={t("documentOpen.label")}
        aria-haspopup="menu"
        aria-expanded={visible}
      >
        {t("documentOpen.label")}
      </Button>
    </Dropdown>
  );
}

export default function DocumentOpenMenu(props: Props) {
  if (!isTauriDesktop()) return null;
  return <DocumentOpenMenuContent key={props.filePath} {...props} />;
}
