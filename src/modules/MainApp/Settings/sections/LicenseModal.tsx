import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { readAppLicense } from "@src/api/tauri/license";
import Modal from "@src/scaffold/ModalSystem";

interface LicenseModalProps {
  visible: boolean;
  onClose: () => void;
}

const LicenseModal: React.FC<LicenseModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation("settings");
  const [licenseText, setLicenseText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    readAppLicense()
      .then((text) => {
        if (!cancelled) setLicenseText(text);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      title={t("general.licenseTitle")}
      onClose={onClose}
      size="large"
      bodyClassName="min-h-0 p-0"
      onOk={onClose}
      okText={t("common:actions.close")}
      cancelText=""
    >
      <div className="allow-select-deep min-h-0 overflow-y-auto p-3">
        {loadError ? (
          <p className="text-sm text-danger-6">
            {t("general.licenseLoadFailed")}
          </p>
        ) : licenseText === null ? (
          <p className="text-sm text-text-2">{t("general.licenseLoading")}</p>
        ) : (
          <pre className="m-0 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-text-1">
            {licenseText}
          </pre>
        )}
      </div>
    </Modal>
  );
};

export default LicenseModal;
