import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import { isHostedKey } from "@src/api/tauri/session";
import type { KanbanTask } from "@src/features/KanbanBoard/types";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import type { Session } from "@src/store/session/sessionAtom/types";
import type { SessionDisplayMetadata } from "@src/util/session/sessionDisplayMetadata";

interface ResolveHoverCardLastModelInput {
  humanSession: boolean;
  session: Session | undefined;
  creatorDefaultLastModel: LastModelSelection | null;
  sessionDisplay: SessionDisplayMetadata | null;
}

export function resolveHoverCardLastModel({
  humanSession,
  session,
  creatorDefaultLastModel,
  sessionDisplay,
}: ResolveHoverCardLastModelInput): LastModelSelection | null {
  if (humanSession) return null;
  if (!session) return creatorDefaultLastModel;
  if (session.importedFrom) {
    return sessionDisplay?.modelName
      ? {
          model: sessionDisplay.modelName,
          cliAgentType: sessionDisplay.cliAgentType,
        }
      : null;
  }
  const keySource = session.keySource ?? creatorDefaultLastModel?.keySource;
  const hosted = isHostedKey(keySource);
  return {
    ...creatorDefaultLastModel,
    keySource,
    cliAgentType: session.cliAgentType ?? creatorDefaultLastModel?.cliAgentType,
    tier: session.tier ?? creatorDefaultLastModel?.tier,
    model: hosted
      ? undefined
      : (session.model ?? creatorDefaultLastModel?.model),
    listingModel: hosted
      ? (session.model ?? creatorDefaultLastModel?.listingModel)
      : undefined,
    selectedAccountId:
      session.accountId ?? creatorDefaultLastModel?.selectedAccountId,
  };
}

export function buildHoverCardImpactTask(
  session: Session | undefined,
  orgtrackSummary: CoreSessionSummary | null
): KanbanTask | null {
  if (!session) return null;
  const sourceFilesChanged =
    session.filesChanged && session.filesChanged > 0
      ? session.filesChanged
      : (session.touchedFiles?.length ?? 0);
  const sourceLinesAdded = session.linesAdded ?? 0;
  const sourceLinesRemoved = session.linesRemoved ?? 0;
  const hasSummaryImpact = Boolean(
    orgtrackSummary &&
    (orgtrackSummary.filesChanged > 0 ||
      orgtrackSummary.linesAdded > 0 ||
      orgtrackSummary.linesRemoved > 0 ||
      orgtrackSummary.relatedCommits > 0)
  );
  const filesChanged = hasSummaryImpact
    ? (orgtrackSummary?.filesChanged ?? 0)
    : sourceFilesChanged;
  const linesAdded = hasSummaryImpact
    ? (orgtrackSummary?.linesAdded ?? 0)
    : sourceLinesAdded;
  const linesRemoved = hasSummaryImpact
    ? (orgtrackSummary?.linesRemoved ?? 0)
    : sourceLinesRemoved;
  const relatedCommits = hasSummaryImpact
    ? (orgtrackSummary?.relatedCommits ?? 0)
    : 0;
  const committedRatePercent = hasSummaryImpact
    ? (orgtrackSummary?.committedRatePercent ?? 0)
    : 0;
  if (
    filesChanged === 0 &&
    linesAdded === 0 &&
    linesRemoved === 0 &&
    relatedCommits === 0
  ) {
    return null;
  }

  return {
    id: session.session_id,
    title: session.name || session.session_id,
    status: "in_progress",
    impact: {
      filesChanged,
      linesAdded,
      linesRemoved,
      relatedCommits,
      committedFiles: Math.round((filesChanged * committedRatePercent) / 100),
      committedRatePercent,
      touchedFiles: session.touchedFiles,
    },
  };
}
