import type { MobileSidebarSessionSnapshotRow } from "@src/api/tauri/mobileRemote";

type Snapshot = readonly MobileSidebarSessionSnapshotRow[];
interface Publication {
  scope: string;
  rows: Snapshot;
  signature: string;
}

/** One in-flight IPC and one replaceable pending snapshot, including across remounts. */
export function createMobileSidebarPublisher(
  publish: (rows: Snapshot) => Promise<unknown>,
  onError: (error: unknown) => void
) {
  let owner: symbol | null = null;
  let latest: Publication | null = null;
  let pending: Publication | null = null;
  let published = "";
  let publishedScope = "";
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let clearRequired = false;

  const schedule = (delay: number) => {
    if (timer !== undefined || inFlight) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(onError);
    }, delay);
  };
  const flush = async () => {
    if (inFlight || !pending) return;
    const next = pending;
    pending = null;
    if (next.signature === published) return;
    if (publishedScope && next.scope !== publishedScope) clearRequired = true;
    inFlight = true;
    try {
      if (clearRequired) {
        clearRequired = false;
        await publish([]);
        published = "";
        publishedScope = "";
        if (latest !== next) return;
      }
      await publish(next.rows);
      published = next.signature;
      publishedScope = next.scope;
      retries = 0;
    } catch (error) {
      onError(error);
      clearRequired = true;
      // One bounded retry. Subsequent changes/focus can recover; no idle poll loop.
      const stillCurrent =
        latest === next || (owner === null && next.signature === "released");
      if (!pending && stillCurrent && retries < 1) {
        retries += 1;
        pending = next;
      }
    } finally {
      inFlight = false;
      if (pending) schedule(retries ? 1000 : 0);
    }
  };

  return {
    acquire() {
      owner = Symbol("desktop-sidebar-publisher");
      return owner;
    },
    update(token: symbol, scope: string, rows: Snapshot) {
      if (token !== owner) return;
      const signature = JSON.stringify([scope, rows]);
      if (signature === latest?.signature) return;
      if (latest && latest.scope !== scope) clearRequired = true;
      latest = { scope, rows, signature };
      pending = latest;
      retries = 0;
      schedule(100);
    },
    revalidate(token: symbol) {
      if (token !== owner || !latest) return;
      published = "";
      pending = latest;
      retries = 0;
      schedule(0);
    },
    release(token: symbol) {
      if (token !== owner) return;
      owner = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      latest = null;
      clearRequired = false;
      // Do not leave a previous account/org's rows in the backend snapshot.
      pending = { scope: "", rows: [], signature: "released" };
      retries = 0;
      schedule(0);
    },
  };
}
