/**
 * CommitSection Component
 *
 * Handles the commit message input and action buttons:
 * - Publish Branch button (when no upstream)
 * - Sync Changes button (when have commits to sync)
 * - Commit button with dropdown for advanced actions
 */
import React, { memo, useState } from "react";

import { Tick01Icon } from "@src/icons";
import { SpotlightFormLayout } from "@src/scaffold/GlobalSpotlight/forms/shared/SpotlightFormLayout";
import { SpotlightFormBody } from "@src/scaffold/GlobalSpotlight/forms/shared/SpotlightFormShell";
import { SpotlightShell } from "@src/scaffold/GlobalSpotlight/shell";

import { GIT_LABELS } from "../config";
import { CommitControls } from "./CommitControls";
import type { CommitSectionProps } from "./commitSectionTypes";

export type { CommitSectionProps } from "./commitSectionTypes";

export const CommitSection: React.FC<CommitSectionProps> = memo((props) => {
  const [open, setOpen] = useState(false);
  const title = props.branchName
    ? `${GIT_LABELS.commit} · ${props.branchName}`
    : GIT_LABELS.commit;
  const openModal = () => setOpen(true);
  return (
    <>
      <CommitControls
        {...props}
        showMessage={false}
        canCommit={!props.commitLoading}
        onCommit={openModal}
        onContinueMerge={props.onContinueMerge ? openModal : undefined}
        onCommitAndPush={props.onCommitAndPush ? openModal : undefined}
        onCommitAndPublish={props.onCommitAndPublish ? openModal : undefined}
        onCommitAndSync={props.onCommitAndSync ? openModal : undefined}
        onAmend={props.onAmend ? openModal : undefined}
      />
      {open && (
        <SpotlightShell isOpen onClose={() => setOpen(false)} hideFooter>
          <SpotlightFormLayout
            role="dialog"
            aria-modal="true"
            aria-label={title}
            header={{
              path: [
                {
                  type: "action",
                  id: "commit",
                  color: "primary",
                  label: title,
                  icon: Tick01Icon,
                },
              ],
              onRemoveSegment: () => setOpen(false),
            }}
          >
            <SpotlightFormBody>
              <CommitControls {...props} showCommitAndPublishButton={false} />
            </SpotlightFormBody>
          </SpotlightFormLayout>
        </SpotlightShell>
      )}
    </>
  );
});

CommitSection.displayName = "CommitSection";

export default CommitSection;
