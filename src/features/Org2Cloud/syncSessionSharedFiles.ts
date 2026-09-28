import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";

import type { CloudEndpoint } from "./config";
import { getCloudCapabilitiesConfirmed } from "./org2CloudCapabilities";
import { readBoundedFile } from "./prepareSharedCommentFiles";
import {
  type SessionSharedFileCandidate,
  collectSessionSharedFiles,
} from "./sessionSharedFileCandidates";
import {
  SharedSessionFileRequestError,
  findSharedSessionFileRevisions,
  uploadSharedSessionFile,
} from "./sharedSessionFilesClient";

const log = createLogger("SessionSharedFiles");
/** Runs inside the existing sender's sync/delivery lifecycle, never as a scanner or timer. */
interface FileSyncContext {
  token: string;
  endpoint: CloudEndpoint;
  orgId: string;
  sessionId: string;
  assertCurrentIdentity: () => void;
  signal?: AbortSignal;
}
export async function syncSessionSharedFiles(
  input: FileSyncContext & {
    events: readonly SessionEvent[];
    repoPath?: string;
  }
): Promise<boolean> {
  const result = await syncSessionSharedFileCandidates({
    ...input,
    candidates: collectSessionSharedFiles(input.events, input.repoPath),
  });
  // Preserve the replay sender's existing acknowledgement contract here.
  // Durable continuation jobs use the sourceUnavailable result independently.
  return result.supported;
}

export async function syncSessionSharedFileCandidates(
  input: FileSyncContext & {
    candidates: readonly SessionSharedFileCandidate[];
    /** Durable output jobs supply a snapshot reader; it must never reopen a source path. */
    readCandidate?: (
      candidate: SessionSharedFileCandidate
    ) => Promise<Uint8Array | null>;
  }
): Promise<{ supported: boolean; sourceUnavailable: boolean }> {
  const { candidates } = input;
  let sourceUnavailable = false;
  if (!candidates.length) return { supported: true, sourceUnavailable };
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
  if (!probe.capabilities.sharedSessionFiles)
    return { supported: false, sourceUnavailable };
  for (let offset = 0; offset < candidates.length; offset += 64) {
    const batch = candidates.slice(offset, offset + 64);
    input.assertCurrentIdentity();
    const existing = await findSharedSessionFileRevisions(
      input.token,
      input.endpoint,
      input.orgId,
      input.sessionId,
      batch,
      input.signal
    );
    input.assertCurrentIdentity();
    for (const candidate of batch) {
      input.assertCurrentIdentity();
      if (existing.has(`${candidate.path}\0${candidate.revision}`)) continue;
      let bytes: Uint8Array;
      if (input.readCandidate) {
        // null is a durable capture failure. IPC/storage exceptions are
        // transient: propagate them so the outbox keeps the captured bytes.
        const captured = await input.readCandidate(candidate);
        if (captured === null) {
          sourceUnavailable = true;
          continue;
        }
        bytes = captured;
      } else {
        try {
          bytes = await readBoundedFile(candidate.path);
        } catch (error) {
          sourceUnavailable = true;
          log.warn(
            `Shared session file unavailable at its source: ${candidate.path}`,
            error
          );
          continue;
        }
      }
      input.assertCurrentIdentity();
      await uploadSharedSessionFile(
        input.token,
        input.endpoint,
        input.orgId,
        input.sessionId,
        candidate.path.split("/").pop() || "file",
        bytes,
        candidate,
        input.signal
      );
      input.assertCurrentIdentity();
    }
  }
  return { supported: true, sourceUnavailable };
}
