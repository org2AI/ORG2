import React from "react";

import { EventBlockHeaderInfo } from "@src/engines/ChatPanel/blocks/primitives/EventBlockHeaderTextSlots";
import Modal from "@src/scaffold/ModalSystem";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import { MobileHeaderIconButton } from "../MobileHeaderIconButton";
import { MobileFileIdentity } from "./MobileFileIdentity";
import MobileFileViewer from "./MobileFileViewer";
import { MobileGenericToolDetail } from "./MobileGenericToolDetail";
import { MobileSearchDetail } from "./MobileSearchDetail";
import { MobileTerminalDetail } from "./MobileTerminalDetail";
import type { MobileFileTarget } from "./mobileFileTool";
import "./mobileToolPreview.scss";
import { useMobileFilePreview } from "./useMobileFilePreview";
import { useMobileToolPresentation } from "./useMobileToolPresentation";

export interface MobileToolDetailModalProps {
  item: TranscriptItem;
  open: boolean;
  onClose: () => void;
  onOpenFile?: (target: MobileFileTarget) => Promise<void>;
}

export function MobileToolDetailModal(props: MobileToolDetailModalProps) {
  return props.open ? (
    <MobileToolDetailContent key={props.item.id} {...props} />
  ) : null;
}

function MobileToolDetailContent({
  item,
  open,
  onClose,
  onOpenFile,
}: MobileToolDetailModalProps) {
  const {
    t,
    title,
    detailSummary,
    output,
    shellDetail,
    searchDetail,
    fileTargets,
    metadataText,
    statusLabel,
    isLoading,
    isFailed,
  } = useMobileToolPresentation(item);
  const { selectedTarget, selectTarget, desktopAction, reset } =
    useMobileFilePreview(fileTargets, onOpenFile);
  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      visible={open}
      onClose={handleClose}
      size="fullscreen"
      radius={0}
      maskClosable={false}
      closable={false}
      className={
        selectedTarget
          ? "mobile-tool-preview mobile-tool-preview--file"
          : "mobile-tool-preview"
      }
      aria-label={selectedTarget?.fileName ?? title}
      title={
        selectedTarget ? <MobileFileIdentity target={selectedTarget} /> : title
      }
      headerActions={
        <>
          {!selectedTarget && (
            <EventBlockHeaderInfo
              isLoading={isLoading}
              className={`mobile-tool-preview__status mobile-type-caption ${
                isFailed
                  ? "text-danger-6"
                  : isLoading
                    ? "text-info-6"
                    : "text-text-3"
              }`}
            >
              {statusLabel}
            </EventBlockHeaderInfo>
          )}
          <MobileHeaderIconButton
            className="mobile-tool-preview__close"
            label={t("transcript.tools.closeDetails")}
            onClick={handleClose}
          />
        </>
      }
      bodyClassName={
        selectedTarget
          ? "mobile-file-viewer__body"
          : "mobile-tool-preview__body"
      }
    >
      {selectedTarget ? (
        <MobileFileViewer
          key={item.id}
          target={selectedTarget}
          targets={fileTargets}
          onSelect={selectTarget}
          truncated={Boolean(item.toolDataTruncated)}
          desktopAction={desktopAction}
        />
      ) : shellDetail ? (
        <MobileTerminalDetail
          {...shellDetail}
          isLoading={isLoading}
          isFailed={isFailed}
          truncated={Boolean(item.toolDataTruncated)}
          truncatedLabel={t("transcript.tools.truncated")}
        />
      ) : searchDetail ? (
        <MobileSearchDetail
          {...searchDetail}
          isLoading={isLoading}
          isFailed={isFailed}
          truncated={Boolean(item.toolDataTruncated)}
          truncatedLabel={t("transcript.tools.truncated")}
        />
      ) : (
        <MobileGenericToolDetail
          itemId={item.id}
          summary={detailSummary}
          metadataText={fileTargets.length === 0 ? metadataText : ""}
          output={fileTargets.length === 0 ? output : ""}
          truncated={Boolean(item.toolDataTruncated)}
          detailsLabel={t("transcript.tools.details")}
          outputLabel={t("transcript.tools.output")}
          truncatedLabel={t("transcript.tools.truncated")}
        />
      )}
    </Modal>
  );
}

MobileToolDetailModal.displayName = "MobileToolDetailModal";
