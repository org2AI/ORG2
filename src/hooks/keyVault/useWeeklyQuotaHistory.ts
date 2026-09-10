import { useEffect, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { WeeklyQuotaHistory } from "@src/api/tauri/rpc/schemas/weeklyQuotaHistory";
import { createLogger } from "@src/hooks/logger";

import {
  currentWeeklyQuotaAccountSignature,
  subscribeWeeklyQuotaAccountChanges,
} from "./weeklyQuotaAccounts";
import { startWeeklyQuotaScheduler } from "./weeklyQuotaScheduler";

const UPDATED = "orgii:weekly-quota-history";
const log = createLogger("WeeklyQuotaHistory");
let readFlight:
  | { identity: string; promise: Promise<WeeklyQuotaHistory> }
  | undefined;
function readHistory(identity: string) {
  if (!readFlight || readFlight.identity !== identity) {
    const request = rpc.validation.getWeeklyQuotaHistory().finally(() => {
      if (readFlight?.promise === request) readFlight = undefined;
    });
    readFlight = { identity, promise: request };
  }
  return readFlight.promise;
}

/** Mounted once by the main window's deferred services. Credentials remain in Rust. */
export function useWeeklyQuotaSampler(): void {
  useEffect(
    () =>
      startWeeklyQuotaScheduler(
        async (isActive) => {
          const accounts = await rpc.validation.listDueWeeklyQuotaAccounts();
          for (const account of accounts) {
            if (!isActive()) break;
            try {
              await rpc.validation.sampleWeeklyQuota({ keyId: account });
            } catch {
              log.warn(
                "An account quota sample could not be stored; continuing with other accounts"
              );
            }
          }
          if (isActive()) window.dispatchEvent(new Event(UPDATED));
        },
        () =>
          log.warn(
            "Weekly quota sampling could not complete; next scheduled attempt in one hour"
          ),
        subscribeWeeklyQuotaAccountChanges
      ),
    []
  );
}

/** Read-only consumers share IPC; mounting charts never triggers provider requests. */
export function useWeeklyQuotaHistory() {
  const [accounts, setAccounts] = useState<WeeklyQuotaHistory>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [observedAt, setObservedAt] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let generation = 0;
    let disposed = false;
    let identity = currentWeeklyQuotaAccountSignature();
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const current = ++generation;
      setObservedAt(Math.floor(Date.now() / 1000));
      setLoading(true);
      void readHistory(identity)
        .then((data) => {
          if (!disposed && current === generation) {
            setAccounts(data);
            setError(false);
          }
        })
        .catch(() => {
          if (!disposed && current === generation) setError(true);
        })
        .finally(() => {
          if (!disposed && current === generation) setLoading(false);
        });
    };
    const unsubscribe = subscribeWeeklyQuotaAccountChanges((nextIdentity) => {
      ++generation;
      identity = nextIdentity;
      setAccounts([]);
      refresh();
    });
    window.addEventListener(UPDATED, refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener(UPDATED, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [revision]);
  return {
    accounts,
    loading,
    error,
    observedAt,
    refresh: () => setRevision((value) => value + 1),
  };
}
