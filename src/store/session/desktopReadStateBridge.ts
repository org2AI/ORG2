import { z } from "zod/v4";

import { createLogger } from "@src/hooks/logger";

const RequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  sessionIds: z.array(z.string().min(1).max(1024)).min(1).max(200),
  markVisited: z.boolean(),
  expiresAtMs: z.number().finite(),
});

interface ReadStateOwnerPort {
  listen: (handler: (payload: unknown) => void) => Promise<() => void>;
  reply: (requestId: string, visitedIds: string[]) => Promise<void>;
  notifyChanged: () => Promise<void>;
  read: () => ReadonlySet<string>;
  mark: (ids: readonly string[]) => void;
  subscribe: (changed: () => void) => () => void;
  onError: (error: unknown) => void;
}

/** Desktop's existing visited atom is the owner; transport only requests and
 * acknowledges operations. Mark-all produces one invalidation, never N RPCs. */
export function startDesktopReadStateBridge(
  port: ReadStateOwnerPort
): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let publishing = false;
  let dirty = false;
  let previous = port.read();
  const publish = () => {
    dirty = true;
    if (publishing) return;
    publishing = true;
    void Promise.resolve()
      .then(async () => {
        try {
          while (!disposed && dirty) {
            dirty = false;
            await port.notifyChanged();
          }
        } catch (error) {
          if (!disposed) port.onError(error);
        } finally {
          publishing = false;
        }
      })
      .catch((error) => logger.warn("Background operation failed", error));
  };
  void port
    .listen((payload) => {
      if (disposed) return;
      const parsed = RequestSchema.safeParse(payload);
      if (!parsed.success || parsed.data.expiresAtMs <= Date.now()) return;
      const { requestId, sessionIds, markVisited } = parsed.data;
      try {
        if (markVisited) {
          const known = port.read();
          port.mark(sessionIds.filter((id) => !known.has(id)));
        }
        const visited = port.read();
        // Never acknowledge a mark based on notification delivery alone.
        void port
          .reply(
            requestId,
            [...new Set(sessionIds)].filter((id) => visited.has(id))
          )
          .catch(port.onError);
      } catch (error) {
        port.onError(error);
      }
    })
    .then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      unsubscribe = port.subscribe(() => {
        const next = port.read();
        const changed =
          next.size !== previous.size ||
          [...next].some((id) => !previous.has(id));
        previous = next;
        if (changed) publish();
      });
      // A phone may have connected while the Desktop shell was still loading.
      publish();
    })
    .catch(port.onError);
  return () => {
    disposed = true;
    unsubscribe?.();
    unlisten?.();
  };
}

const logger = createLogger("desktopReadStateBridge");
