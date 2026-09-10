/** Paste-a-share-link entry point: the parsed link is queued as a unique attempt; `CloudShareImportDialog` owns the registered-user resolve → import flow. */
import { useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Textarea from "@src/components/Textarea";
import { Download01Icon } from "@src/icons";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";
import { SpotlightPillBar } from "@src/scaffold/GlobalSpotlight/components/SpotlightPillBar";
import {
  SpotlightFormBody,
  SpotlightFormShell,
} from "@src/scaffold/GlobalSpotlight/forms/shared";
import { SpotlightShell } from "@src/scaffold/GlobalSpotlight/shell";

import { parseCloudShareInput } from "./org2CloudOrgManagement";
import { queueOrg2CloudPendingShareAtom } from "./org2CloudPendingShareAtom";

interface ImportSharedSessionDialogProps {
  visible: boolean;
  onClose: () => void;
  asBody?: boolean;
  onGoBack?: () => void;
}

const ImportSharedSessionDialog: React.FC<ImportSharedSessionDialogProps> = ({
  visible,
  onClose,
  asBody = false,
  onGoBack,
}) => {
  const { t } = useTranslation(["navigation", "common"]);
  const queuePendingShare = useSetAtom(queueOrg2CloudPendingShareAtom);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const handleClose = useCallback(() => {
    setValue("");
    setInvalid(false);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    const parsed = parseCloudShareInput(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    queuePendingShare(parsed);
    handleClose();
  }, [handleClose, queuePendingShare, value]);

  const body = (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={t("cloud.share.importEntry")}
    >
      <SpotlightPillBar
        path={[
          {
            type: "action",
            id: "import-session",
            label: t("cloud.share.importEntry"),
            icon: Download01Icon,
            color: "primary",
          },
        ]}
        onRemoveSegment={() => {
          setValue("");
          setInvalid(false);
          (onGoBack ?? onClose)();
        }}
      />
      <SpotlightFormShell>
        <SpotlightFormBody>
          <div
            className="flex flex-col gap-2"
            data-testid="import-session-dialog"
          >
            <Textarea
              value={value}
              onChange={(next) => {
                setValue(next);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={t("cloud.share.importInputPlaceholder")}
              error={invalid}
              aria-invalid={invalid}
              aria-describedby={
                invalid ? "import-session-input-error" : undefined
              }
              aria-label={t("cloud.share.importEntry")}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              rows={3}
              resize="vertical"
              size="large"
              data-testid="import-session-input"
            />
            {invalid && (
              <div
                id="import-session-input-error"
                role="alert"
                className="text-xs text-danger-6"
              >
                {t("cloud.share.importInvalidInput")}
              </div>
            )}
          </div>
        </SpotlightFormBody>
        <PanelFooter
          secondaryActions={[
            { label: t("common:actions.cancel"), onClick: handleClose },
          ]}
          primaryAction={{
            label: t("cloud.share.importSubmit"),
            onClick: handleSubmit,
            disabled: !value.trim(),
            dataTestId: "import-session-submit",
          }}
        />
      </SpotlightFormShell>
    </section>
  );
  if (asBody) return visible ? body : null;
  return (
    <SpotlightShell
      isOpen={visible}
      onClose={handleClose}
      hasActiveAction
      hideFooter
    >
      {body}
    </SpotlightShell>
  );
};

export default ImportSharedSessionDialog;
