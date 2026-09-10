import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ButtonProps } from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_WIDTHS } from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import SplitButton from "@src/components/SplitButton";
import { isMacOS, isTauriDesktop } from "@src/util/platform/tauri";

import ApplicationIcon from "./ApplicationIcon";
import {
  type DocumentApplication,
  loadDocumentApplications,
  openDocument,
} from "./documentApplications";

interface Props {
  filePath: string;
  hasUnsavedChanges: boolean;
  position?: React.ComponentProps<typeof Dropdown>["position"];
  children?: React.ReactElement<ButtonProps>;
}

function DocumentOpenMenuContent({
  filePath,
  hasUnsavedChanges,
  children,
  position,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [apps, setApps] = useState<DocumentApplication[]>([]);
  const [loading, setLoading] = useState(isMacOS);
  const [opening, setOpening] = useState(false);
  const applicationIcon = (path?: string) => <ApplicationIcon path={path} />;

  useEffect(() => {
    if (!isMacOS()) return;
    let cancelled = false;
    void loadDocumentApplications(filePath)
      .then((result) => {
        if (!cancelled) setApps(result);
      })
      .catch(() => {
        if (!cancelled) Message.error(t("documentOpen.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, t]);

  const defaultApp = apps.find((app) => app.isDefault);
  const openLabel = loading
    ? t("documentOpen.loading")
    : defaultApp
      ? t("documentOpen.openInDefault", { name: defaultApp.name })
      : t("documentOpen.openDefaultApp");

  const menu = (
    <div className="absolute inset-x-0 bottom-0 grid text-left">
      <Dropdown
        position={position}
        className={`${DROPDOWN_WIDTHS.menuClass} w-max`}
        style={{ minWidth: "100%" }}
        loading={loading}
        popupVisible={visible}
        onVisibleChange={setVisible}
        options={[
          ...(!defaultApp
            ? [{ value: "default", label: t("documentOpen.defaultApp") }]
            : []),
          ...apps.map((app) => ({
            value: app.path,
            icon: applicationIcon(app.path),
            label: app.isDefault
              ? t("documentOpen.appDefault", { name: app.name })
              : app.name,
          })),
        ]}
        onSelect={(value) => {
          if (hasUnsavedChanges || opening || loading) return;
          setVisible(false);
          setOpening(true);
          void openDocument(
            filePath,
            value === "default" ? undefined : String(value)
          )
            .catch(() => Message.error(t("documentOpen.openFailed")))
            .finally(() => setOpening(false));
        }}
        disabled={hasUnsavedChanges || opening || loading}
      >
        <div />
      </Dropdown>
    </div>
  );
  return (
    <div className={`flex justify-center ${children?.props.className ?? ""}`}>
      <SplitButton
        {...children?.props}
        className=""
        size={children?.props.size ?? "default"}
        widthMode="hug"
        icon={loading ? undefined : applicationIcon(defaultApp?.path)}
        disabled={hasUnsavedChanges || opening || loading}
        loading={opening || loading}
        onClick={() => {
          if (hasUnsavedChanges || opening || loading) return;
          setOpening(true);
          void openDocument(filePath)
            .catch(() => Message.error(t("documentOpen.openFailed")))
            .finally(() => setOpening(false));
        }}
        title={hasUnsavedChanges ? t("documentOpen.saveFirst") : openLabel}
        menu={menu}
        menuOpen={visible}
        menuButtonLabel={t("documentOpen.label")}
        onMenuButtonClick={(event) => {
          event.stopPropagation();
          setVisible(!visible);
        }}
      >
        {openLabel}
      </SplitButton>
    </div>
  );
}

export default function DocumentOpenMenu(props: Props) {
  if (!isTauriDesktop()) return null;
  return <DocumentOpenMenuContent key={props.filePath} {...props} />;
}
