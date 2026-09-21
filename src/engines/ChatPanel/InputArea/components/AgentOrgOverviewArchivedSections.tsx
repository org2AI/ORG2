import React from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunView } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { Alert01Icon, Delete02Icon, HugeiconsIcon } from "@src/icons";

interface AgentOrgOverviewArchivedSectionsProps {
  view: AgentOrgRunView;
  onRequestDelete: () => void;
}

const AgentOrgOverviewArchivedSections: React.FC<
  AgentOrgOverviewArchivedSectionsProps
> = ({ view, onRequestDelete }) => {
  const { t } = useTranslation("sessions");
  return (
    <>
      {view.archiveTeardown && (
        <div
          className="rounded-md bg-bg-1 px-2 py-2 text-[11px] text-text-3"
          data-testid="agent-org-archive-teardown-status"
          data-teardown-status={view.archiveTeardown.status}
        >
          {view.archiveTeardown.status === "pending"
            ? t("planner.agentOrgOverview.archiveTeardownPending", {
                defaultValue:
                  "Archived. Runtime shutdown is still finishing in the background.",
              })
            : view.archiveTeardown.status === "retained_runtime"
              ? t("planner.agentOrgOverview.archiveTeardownRetained", {
                  count: view.archiveTeardown.retainedRuntimeCount,
                  defaultValue:
                    "Archived, but {{count}} runtime could not be released. Delete remains blocked.",
                })
              : t("planner.agentOrgOverview.archiveTeardownQuiesced", {
                  defaultValue:
                    "Archived and fully stopped. Permanent deletion is now available.",
                })}
        </div>
      )}

      <div
        className="border-error-6/20 space-y-2 rounded-md border px-2 py-2"
        data-testid="agent-org-danger-zone"
      >
        <div className="text-error-6 flex items-center gap-1 text-[11px] font-medium">
          <HugeiconsIcon
            icon={Alert01Icon}
            data-icon="alert-triangle"
            size={11}
            strokeWidth={2}
          />
          {t("planner.agentOrgOverview.dangerZone", {
            defaultValue: "Danger Zone",
          })}
        </div>
        <div className="text-[10px] leading-4 text-text-3">
          {t("planner.agentOrgOverview.deleteDescription", {
            defaultValue:
              "Permanently delete this Team and all of its sessions and history.",
          })}
        </div>
        <Button
          variant="primary"
          tone="danger"
          size="mini"
          disabled={view.archiveTeardown?.status !== "quiesced"}
          onClick={onRequestDelete}
          data-testid="agent-org-overview-delete-button"
          icon={
            <HugeiconsIcon
              icon={Delete02Icon}
              data-icon="trash-2"
              size={11}
              strokeWidth={2}
            />
          }
        >
          {t("planner.agentOrgOverview.deleteTeam", {
            defaultValue: "Delete Team",
          })}
        </Button>
      </div>
    </>
  );
};

export default AgentOrgOverviewArchivedSections;
