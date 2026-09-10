/**
 * InlineCredentialImport — "Import credentials from other apps" panel.
 *
 * Visually and behaviourally a sibling of `InlineExternalImport` (the
 * skills / rules / MCP / agents auto-import rows): a collapsed section row
 * with an Expand toggle, and when expanded a SettingsTable of importable
 * rows with select-all, search, per-item failures, and an "Import (n)"
 * button. The header uses the same concise import wording as its siblings.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import SettingsTable from "@src/components/SettingsTable";
import {
  ChevronsDownUpIcon,
  HugeiconsIcon,
  ImportIcon,
  UnfoldMoreIcon,
} from "@src/icons";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { credentialImportRowKey } from "./credentialImportUtils";
import { useCredentialImport } from "./useCredentialImport";

interface InlineCredentialImportProps {
  sourceKind?: "cc_switch";
  /** Reload agents / accounts after a successful import. */
  onAfterImport?: () => void | Promise<void>;
}

const InlineCredentialImport: React.FC<InlineCredentialImportProps> = ({
  sourceKind,
  onAfterImport,
}) => {
  const { t } = useTranslation("integrations");
  const [expanded, setExpanded] = useState(false);

  const {
    items,
    allImportableItems,
    importableItems,
    selected,
    importLoading,
    importing,
    importError,
    importErrors,
    importColumns,
    handleRowClick,
    handleImport,
  } = useCredentialImport({
    sourceKind,
    onCompleted: () => undefined,
    onRefresh: onAfterImport,
  });

  const title = t("credentialImport.title");

  return (
    <SectionContainer>
      <SectionRow label={title}>
        <Button
          variant="secondary"
          icon={
            expanded ? (
              <HugeiconsIcon
                icon={ChevronsDownUpIcon}
                data-icon="chevrons-down-up"
                size={14}
              />
            ) : (
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                data-icon="chevrons-up-down"
                size={14}
              />
            )
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {t("common:actions.expand")}
        </Button>
      </SectionRow>

      {expanded && (
        <SectionRow showHeader={false} className="pt-0">
          <div className="flex flex-col gap-3">
            {importLoading && items.length === 0 ? null : items.length === 0 ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("credentialImport.empty")}
              </div>
            ) : allImportableItems.length === 0 ? (
              <div className="rounded-md bg-fill-2 px-3 py-2 text-[12px] text-text-3">
                {t("credentialImport.allImported")}
              </div>
            ) : (
              <SettingsTable
                columns={importColumns}
                onRowClick={handleRowClick}
                rows={importableItems}
                getRowKey={credentialImportRowKey}
                headerHeight="tall"
                noPx
                className="table-settings-expanded-compact"
              />
            )}

            {importError && (
              <PageNotice type="danger" role="alert">
                {t("credentialImport.applyFailed", { message: importError })}
              </PageNotice>
            )}
            {importErrors.length > 0 && (
              <PageNotice
                type="warning"
                role="alert"
                title={t("credentialImport.partialFailure")}
              >
                <ul className="list-inside list-disc">
                  {importErrors.map((entry) => (
                    <li key={entry.id}>
                      <span className="font-bold">{entry.displayName}</span>{" "}
                      <span className="font-mono text-[11px]">
                        ({entry.sourceLabel})
                      </span>
                      : {entry.error}
                    </li>
                  ))}
                </ul>
              </PageNotice>
            )}

            {allImportableItems.length > 0 && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="small"
                  icon={
                    <HugeiconsIcon
                      icon={ImportIcon}
                      data-icon="import"
                      size={14}
                    />
                  }
                  disabled={selected.size === 0}
                  loading={importing}
                  onClick={handleImport}
                >
                  {t("agentOrgs.importSelected", { count: selected.size })}
                </Button>
              </div>
            )}
          </div>
        </SectionRow>
      )}
    </SectionContainer>
  );
};

export default InlineCredentialImport;
