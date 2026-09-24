import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import type { Store } from "jotai/vanilla/store";

import { rpc } from "@src/api/tauri/rpc";
import { createLogger } from "@src/hooks/logger";

import { createBoundCloudAuth } from "./SessionConversation/cloudConversationQueueAdapter.boundAuth";
import {
  CONVERSATION_FILE_OUTBOX_CHANGED,
  conversationFileOutboxSignalAtom,
} from "./conversationFileOutbox";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { org2CloudOrgsAtom } from "./org2CloudOrgsAtom";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

const log = createLogger("ConversationFileDelivery");
const MAX_JOBS_PER_DRAIN = 32;
const MAX_RETRY_MS = 30 * 60_000;
type Outcome = Parameters<typeof rpc.cloudFileOutbox.settle>[0]["outcome"];

/** One consumer per sync-engine lifetime; SQLite leases arbitrate other windows/processes. */
export class ConversationFileDelivery {
  private store: Store | null = null;
  private unsubscribers: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private dirty = false;
  private generation = 0;
  private scope = "";
  private storageFailures = 0;
  private peerUnlisten: Promise<UnlistenFn> | null = null;

  start(store: Store): void {
    if (this.store) return;
    this.store = store;
    this.scope = this.scopeKey();
    this.unsubscribers = [
      store.sub(conversationFileOutboxSignalAtom, this.wake),
      store.sub(org2CloudAuthAtom, this.scopeChanged),
      store.sub(org2CloudOrgsAtom, this.scopeChanged),
    ];
    this.peerUnlisten = listen(
      CONVERSATION_FILE_OUTBOX_CHANGED,
      this.wake
    ).catch((error) => {
      log.warn("Attachment delivery peer notifications unavailable", error);
      return () => undefined;
    });
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.environmentChanged);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.environmentChanged);
      window.addEventListener("offline", this.environmentChanged);
    }
    this.wake();
  }

  stop(): void {
    this.store = null;
    this.generation++;
    this.controller?.abort();
    this.clearTimer();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    void this.peerUnlisten
      ?.then((unlisten) => unlisten())
      .catch((error) => {
        log.warn("Attachment delivery peer cleanup failed", error);
      });
    this.peerUnlisten = null;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.environmentChanged);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.environmentChanged);
      window.removeEventListener("offline", this.environmentChanged);
    }
    // Do not reset running: even aborted work owns its slot until it settles.
    this.dirty = false;
  }

  private canRun(): boolean {
    return (
      Boolean(this.store?.get(org2CloudAuthAtom)) &&
      (typeof document === "undefined" ||
        document.visibilityState !== "hidden") &&
      (typeof navigator === "undefined" || navigator.onLine !== false)
    );
  }

  private scopeKey(): string {
    const auth = this.store?.get(org2CloudAuthAtom);
    if (!auth) return "";
    return JSON.stringify([
      org2CloudAuthIdentityKey(auth),
      this.store
        ?.get(org2CloudOrgsAtom)
        .map((org) => [org.orgId, org.homeEndpoint]),
    ]);
  }

  private readonly scopeChanged = (): void => {
    const next = this.scopeKey();
    if (next === this.scope) return; // Token refresh is not an identity change.
    this.scope = next;
    this.generation++;
    this.controller?.abort();
    this.wake();
  };

  private readonly environmentChanged = (): void => {
    if (!this.canRun()) {
      this.generation++;
      this.controller?.abort();
      this.clearTimer();
    } else this.wake();
  };

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    if (!this.canRun()) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.wake();
      },
      Math.min(Math.max(delay, 0), MAX_RETRY_MS)
    );
  }

  private readonly wake = (): void => {
    this.clearTimer();
    if (!this.canRun()) return;
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    void this.drain()
      .catch((error) => {
        log.warn(
          "Attachment delivery remains pending in the local outbox",
          error
        );
        this.storageFailures = Math.min(this.storageFailures + 1, 9);
        this.schedule(5_000 * 2 ** this.storageFailures);
      })
      .finally(() => {
        this.running = false;
        this.controller = null;
        if (this.dirty) {
          this.dirty = false;
          this.wake();
        }
      });
  };

  private async drain(): Promise<void> {
    const store = this.store;
    const auth = store?.get(org2CloudAuthAtom);
    if (!store || !auth || !this.canRun()) return;
    const identity = org2CloudAuthIdentityKey(auth);
    const endpoint = auth.supabaseUrl.trim().replace(/\/+$/, "");
    const orgIds = store
      .get(org2CloudOrgsAtom)
      .filter(
        (org) =>
          !org.homeEndpoint ||
          org.homeEndpoint.trim().replace(/\/+$/, "") === endpoint
      )
      .map((org) => org.orgId);
    if (!orgIds.length) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () =>
      this.store === store &&
      generation === this.generation &&
      !controller.signal.aborted &&
      this.canRun();
    const bound = createBoundCloudAuth({
      store,
      expectedIdentityKey: identity,
      sourceEndpointUrl: endpoint,
    });
    const assertCurrent = () => {
      if (!current())
        throw new Error("Attachment delivery is no longer active");
      bound.requireBoundAuth();
    };
    for (let count = 0; count < MAX_JOBS_PER_DRAIN && current(); count++) {
      const { job, retryAt } = await rpc.cloudFileOutbox.claim({
        identity,
        orgIds,
      });
      this.storageFailures = 0;
      if (!job) {
        if (current() && retryAt !== null) this.schedule(retryAt - Date.now());
        return;
      }
      let outcome: Outcome = "cancelled";
      try {
        assertCurrent();
        const fresh = await bound.refreshBoundAuth();
        assertCurrent();
        const { syncSessionSharedFileCandidates } =
          await import("./syncSessionSharedFiles");
        assertCurrent();
        const result = await syncSessionSharedFileCandidates({
          token: fresh.accessToken,
          endpoint: {
            supabaseUrl: fresh.supabaseUrl,
            anonKey: fresh.supabaseAnonKey,
            webOrigin: "",
            isOfficial: false,
          },
          orgId: job.orgId,
          sessionId: job.sessionId,
          candidates: [{ path: job.path, revision: job.revision }],
          assertCurrentIdentity: assertCurrent,
          signal: controller.signal,
        });
        assertCurrent();
        outcome = !result.supported
          ? "retry"
          : result.sourceUnavailable
            ? "source_unavailable"
            : "uploaded";
      } catch (error) {
        if (current())
          outcome =
            error instanceof SharedSessionFileRequestError &&
            error.code === "ORG2_QUOTA_EXCEEDED"
              ? "quota"
              : "retry";
      }
      await rpc.cloudFileOutbox.settle({
        identity,
        id: job.id,
        lease: job.lease,
        outcome,
      });
    }
    if (current()) this.schedule(0); // Yield between bounded pages of known work.
  }
}
