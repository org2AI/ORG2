import React from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import type { Person } from "@src/types/core/shared";

import type { useWorkItemPropertyView } from "../hooks/useWorkItemPropertyView";
import type { useWorkItems } from "../hooks/useWorkItems";
import type { BatchQuickField } from "../workItemPartialUpdate";
import BatchPropertyDialog from "./BatchPropertyDialog";
import BatchQuickFieldDialog from "./BatchQuickFieldDialog";
import RevisionConflictModal from "./RevisionConflictModal";

type WorkItemsPageData = ReturnType<typeof useWorkItems>["data"];

interface WorkItemsPageDialogsProps {
  orgId: string;
  projectSlug: string | null;
  shortIds: string[];
  members: Person[];
  batchPropertyOpen: boolean;
  onCloseBatchProperty: () => void;
  batchQuickField: BatchQuickField | null;
  onCloseBatchQuickField: () => void;
  onUnselectAll: () => void;
  refreshWorkItems: WorkItemsPageData["refresh"];
  refreshPropertyView: ReturnType<typeof useWorkItemPropertyView>["refresh"];
  revisionConflict: WorkItemsPageData["revisionConflict"];
  onUseLatestRevisionConflict: WorkItemsPageData["useLatestRevisionConflict"];
  onKeepMineRevisionConflict: WorkItemsPageData["keepMineRevisionConflict"];
}

/**
 * Modal layer for the Work Items page: batch property / quick-field dialogs
 * for the multi-select bar and the title/description revision conflict modal.
 */
const WorkItemsPageDialogs: React.FC<WorkItemsPageDialogsProps> = ({
  orgId,
  projectSlug,
  shortIds,
  members,
  batchPropertyOpen,
  onCloseBatchProperty,
  batchQuickField,
  onCloseBatchQuickField,
  onUnselectAll,
  refreshWorkItems,
  refreshPropertyView,
  revisionConflict,
  onUseLatestRevisionConflict,
  onKeepMineRevisionConflict,
}) => {
  const { t } = useTranslation("projects");

  return (
    <>
      <BatchPropertyDialog
        open={batchPropertyOpen}
        orgId={orgId}
        projectSlug={projectSlug}
        shortIds={shortIds}
        members={members}
        onClose={onCloseBatchProperty}
        onApplied={() => {
          onUnselectAll();
          void refreshWorkItems().catch((error: unknown) =>
            Message.error(String(error))
          );
          void refreshPropertyView().catch((error: unknown) =>
            Message.error(String(error))
          );
        }}
      />
      <BatchQuickFieldDialog
        open={batchQuickField !== null}
        field={batchQuickField ?? "status"}
        orgId={orgId}
        projectSlug={projectSlug}
        shortIds={shortIds}
        members={members}
        onClose={onCloseBatchQuickField}
        onApplied={() => {
          onUnselectAll();
          void refreshWorkItems().catch((error: unknown) =>
            Message.error(String(error))
          );
          void refreshPropertyView().catch((error: unknown) =>
            Message.error(String(error))
          );
        }}
      />
      <RevisionConflictModal
        conflict={
          revisionConflict
            ? {
                fieldLabel: t(
                  revisionConflict.field === "title"
                    ? "workItems.revisionConflict.titleField"
                    : "workItems.revisionConflict.descriptionField"
                ),
                mine: revisionConflict.mine,
                latest: revisionConflict.latest,
                expectedRevision: revisionConflict.expectedRevision,
                actualRevision: revisionConflict.actualRevision,
              }
            : null
        }
        onUseLatest={onUseLatestRevisionConflict}
        onKeepMine={onKeepMineRevisionConflict}
      />
    </>
  );
};

export default WorkItemsPageDialogs;
