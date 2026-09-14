import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { TranscriptSubscribeResult } from "./transcriptLoadState";

type HistoryClient = Pick<MobileRpcClient, "call">;
const MAX_DIRECTORY_READS = 8;
const directoryReads = new WeakMap<
  HistoryClient,
  Map<string, Promise<TranscriptSubscribeResult>>
>();

function directoryRead(client: HistoryClient, sessionId: string) {
  let reads = directoryReads.get(client);
  if (!reads) {
    reads = new Map();
    directoryReads.set(client, reads);
  }
  const existing = reads.get(sessionId);
  if (existing) return existing;
  if (reads.size >= MAX_DIRECTORY_READS) return null;
  const read = client.call<TranscriptSubscribeResult>("session/history", {
    sessionId,
  });
  reads.set(sessionId, read);
  const release = () => {
    if (reads.get(sessionId) === read) reads.delete(sessionId);
  };
  void read.then(release, release);
  return read;
}

/**
 * A subscription owns the first body; directory hydration is a read-only RPC.
 * All results belong to the caller's connection/session/generation. No timers,
 * settled-data caches or detached server jobs are created; RPC lifetime stays client-owned.
 */
export async function loadSubscriptionHistory(
  client: HistoryClient,
  sessionId: string,
  isCurrent: () => boolean,
  apply: (result: TranscriptSubscribeResult) => void,
  latestOnly = true
): Promise<boolean> {
  const first = await client.call<TranscriptSubscribeResult>(
    "session/subscribe",
    { sessionId, latestOnly }
  );
  if (!isCurrent()) return false;
  apply(first);
  if (first.historyDeferred === true) {
    // Return immediately so model/permission hydration is not held behind the
    // full history read. Closing the owning client terminates this RPC.
    void directoryRead(client, sessionId)
      ?.then((result) => {
        if (isCurrent()) apply(result);
      })
      .catch(() => {
        // Keep the successful latest body and incomplete directory. Reopening
        // or the next explicit refresh retries, without a retry/polling loop.
      });
  }
  return true;
}
