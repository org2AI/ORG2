import { useTranslation } from "react-i18next";

import { formatToolName } from "@src/util/ui/rendering/formatToolName";

import type { TranscriptItem } from "../../lib/transcriptReducer";
import { mobileFileTargets } from "./mobileFileTool";
import {
  compactMetadata,
  mobileSearchDetail,
  mobileShellDetail,
  mobileToolDetailSummary,
  mobileToolSummary,
  normalizeMobileToolLifecycle,
  outputFromToolData,
  record,
  resolveMobileToolIconName,
  stringValue,
  toolLabelKey,
} from "./mobileToolPresentation";

export function useMobileToolPresentation(item: TranscriptItem) {
  const { t } = useTranslation("mobileRemote");
  const lifecycle = normalizeMobileToolLifecycle(item.toolStatus);
  const labelKey = toolLabelKey(item);
  const rawName = resolveMobileToolIconName(item);
  const title = labelKey
    ? t(`transcript.tools.labels.${labelKey}`)
    : formatToolName(rawName);
  const summary = mobileToolSummary(item);
  const detailSummary = mobileToolDetailSummary(item);
  const output = outputFromToolData(item.toolData);
  const shellDetail = mobileShellDetail(item);
  const searchDetail = mobileSearchDetail(item);
  const fileTargets = mobileFileTargets(item);
  const metadata = compactMetadata(item.toolData);
  const metadataText =
    Object.keys(metadata).length > 0 ? JSON.stringify(metadata, null, 2) : "";
  const hasDetails = Boolean(
    fileTargets.length > 0 || output || metadataText || item.toolDataTruncated
  );
  const statusLabel = t(`transcript.tools.status.${lifecycle}`);
  const isLoading = lifecycle === "running";
  const isFailed = lifecycle === "failed";

  return {
    t,
    lifecycle,
    rawName,
    action: stringValue(record(item.toolData)?.action) || undefined,
    title,
    summary,
    detailSummary,
    output,
    shellDetail,
    searchDetail,
    fileTargets,
    metadataText,
    hasDetails,
    statusLabel,
    isLoading,
    isFailed,
  };
}
