import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Coins01Icon } from "@src/icons";
import { PanelRefreshButton } from "@src/modules/shared/layouts/blocks";
import { SpotlightPillBar } from "@src/scaffold/GlobalSpotlight/components/SpotlightPillBar";
import {
  SpotlightFormBody,
  SpotlightFormShell,
} from "@src/scaffold/GlobalSpotlight/forms/shared";
import { SpotlightShell } from "@src/scaffold/GlobalSpotlight/shell";

import {
  type QuotaRefreshControl,
  StartPageQuotaGrid,
} from "./StartPageQuotaGrid";

interface StartPageQuotaModalProps {
  onClose: () => void;
  visible: boolean;
}

/** Reuses the Runtime quota surface for the Launchpad quick action. */
export function StartPageQuotaModal({
  onClose,
  visible,
}: StartPageQuotaModalProps): React.ReactNode {
  const { t } = useTranslation("sessions");
  const [paginationContainer, setPaginationContainer] =
    useState<HTMLDivElement | null>(null);
  const [refreshControl, setRefreshControl] =
    useState<QuotaRefreshControl | null>(null);
  const handleRefreshControlChange = useCallback(
    (control: QuotaRefreshControl | null) => setRefreshControl(control),
    []
  );
  const refreshLabel = t("chat.startPage.quota.refresh");

  return (
    <SpotlightShell
      isOpen={visible}
      onClose={onClose}
      hasActiveAction
      hideFooter
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("kanban.dataSource.views.quota")}
      >
        <SpotlightPillBar
          path={[
            {
              type: "action",
              id: "quota",
              label: t("kanban.dataSource.views.quota"),
              icon: Coins01Icon,
              color: "primary",
            },
          ]}
          onRemoveSegment={onClose}
          trailingSlotAlign="end"
          trailingSlot={
            <div className="flex items-center gap-1">
              <div ref={setPaginationContainer} />
              <PanelRefreshButton
                dataTestId="quota-modal-refresh"
                disabled={refreshControl === null || refreshControl.disabled}
                loading={refreshControl?.refreshing ?? false}
                onRefresh={refreshControl?.onRefresh ?? (() => undefined)}
                title={refreshLabel}
              />
            </div>
          }
        />
        <SpotlightFormShell>
          <div className="max-h-[70vh] overflow-y-auto">
            <SpotlightFormBody>
              <StartPageQuotaGrid
                showHeader={false}
                paginate
                paginationContainer={paginationContainer}
                onRefreshControlChange={handleRefreshControlChange}
              />
            </SpotlightFormBody>
          </div>
        </SpotlightFormShell>
      </section>
    </SpotlightShell>
  );
}
