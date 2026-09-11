import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";

import type { CloudEndpoint } from "./config";
import { getCloudCapabilitiesConfirmed } from "./org2CloudCapabilities";
import { readBoundedFile } from "./prepareSharedCommentFiles";
import { collectSessionSharedFiles } from "./sessionSharedFileCandidates";
import {
  SharedSessionFileRequestError,
  findSharedSessionFileRevisions,
  uploadSharedSessionFile,
} from "./sharedSessionFilesClient";

const log = createLogger("SessionSharedFiles");
/** Runs inside the existing sender's sync/delivery lifecycle, never as a scanner or timer. */
export async function syncSessionSharedFiles(input: {
  token: string;
  endpoint: CloudEndpoint;
  orgId: string;
  sessionId: string;
  events: readonly SessionEvent[];
  repoPath?: string;
  assertCurrentIdentity: () => void;
}): Promise<boolean> {
  const candidates = collectSessionSharedFiles(input.events, input.repoPath);
  if (!candidates.length) return true;
  input.assertCurrentIdentity();
  const probe = await getCloudCapabilitiesConfirmed(
    input.token,
    input.endpoint
  );
  if (!probe.confirmed)
    throw new SharedSessionFileRequestError(
      "File sharing capability probe is temporarily unavailable",
      null,
      true
    );
  if (!probe.capabilities.sharedSessionFiles) return false;
  for (let offset = 0; offset < candidates.length; offset += 64) {
    const batch = candidates.slice(offset, offset + 64);
    input.assertCurrentIdentity();
    const existing = await findSharedSessionFileRevisions(
      input.token,
      input.endpoint,
      input.orgId,
      input.sessionId,
      batch
    );
    input.assertCurrentIdentity();
    for (const candidate of batch) {
      if (existing.has(`${candidate.path}\0${candidate.revision}`)) continue;
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedFile(candidate.path);
      } catch (error) {
        // Historical transcripts may outlive local artifacts. Do not stop the
        // replay for an absent file or publish a false available-file record.
        log.warn(
          `Shared session file unavailable at its source: ${candidate.path}`,
          error
        );
        continue;
      }
      input.assertCurrentIdentity();
      await uploadSharedSessionFile(
        input.token,
        input.endpoint,
        input.orgId,
        input.sessionId,
        candidate.path.split("/").pop() || "file",
        bytes,
        candidate
      );
      input.assertCurrentIdentity();
    }
  }
  return true;
}
