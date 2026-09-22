/**
 * Locked reads of the unified delivery registry, including the one-time
 * migration of legacy per-window `queue:<label>` keys into it.
 */
import type { Store } from "@tauri-apps/plugin-store";

import { createLogger } from "@src/hooks/logger";

import {
  type ActiveMessageDelivery,
  type QueuedMessage,
  boundQueuedMessages,
} from "./messageQueueAtom";
import {
  type DurableMessageDelivery,
  type DurableQueuedMessage,
  isActiveDelivery,
  isQueuedMessage,
  toQueuedMessage,
  validatedDurableMessageDeliveries,
} from "./messageQueueRecordValidation";
import { STORE_KEY_PREFIX } from "./messageQueueStore";

const log = createLogger("messageQueueRepository");
export const DELIVERY_RECORDS_KEY = "deliveries";

let legacyQueueMigrationComplete = false;

export async function readDeliveriesLocked(
  store: Store
): Promise<DurableMessageDelivery[]> {
  const deliveries = validatedDurableMessageDeliveries(
    await store.get<unknown>(DELIVERY_RECORDS_KEY)
  );
  if (legacyQueueMigrationComplete) return deliveries;
  const legacyKeys = (await store.keys())
    .filter((key) => key.startsWith(`${STORE_KEY_PREFIX}:`))
    .sort();
  if (legacyKeys.length === 0) {
    legacyQueueMigrationComplete = true;
    return deliveries;
  }

  const legacyEntries = await Promise.all(
    legacyKeys.map(async (key) => [key, await store.get<unknown>(key)] as const)
  );
  const seenIds = new Set(deliveries.map((record) => record.id));
  const seenIntentIds = new Set(
    deliveries.map((record) => record.turnIntentId)
  );
  const migrated = [...deliveries];
  for (const [key, stored] of legacyEntries) {
    if (!Array.isArray(stored)) continue;
    const recovered = boundQueuedMessages(stored.filter(isQueuedMessage));
    for (const message of recovered) {
      if (seenIds.has(message.id) || seenIntentIds.has(message.turnIntentId)) {
        continue;
      }
      seenIds.add(message.id);
      seenIntentIds.add(message.turnIntentId);
      migrated.push({ ...message, originQueueKey: key });
    }
  }
  const validated = validatedDurableMessageDeliveries(migrated);

  // Commit the unified registry before removing any legacy owner. If this
  // save fails, every queue:<window> key remains available for a later retry.
  await store.set(DELIVERY_RECORDS_KEY, validated);
  await store.save();

  try {
    for (const key of legacyKeys) await store.delete(key);
    await store.save();
  } catch (error) {
    // Cleanup is best-effort but must not leave an in-memory Store instance
    // pretending the legacy rows were removed when its save failed. Restore
    // them so the next hydrate can retry the same idempotent migration.
    for (const [key, stored] of legacyEntries) await store.set(key, stored);
    try {
      await store.save();
    } catch (restoreError) {
      log.warn(
        "[messageQueueRepository] failed to restore legacy queue keys after cleanup failure",
        restoreError
      );
    }
    throw error;
  }
  legacyQueueMigrationComplete = true;
  return validated;
}

export interface DurableMessageDeliverySnapshot {
  queue: QueuedMessage[];
  active: ActiveMessageDelivery[];
}

export async function readDeliverySnapshotLocked(
  store: Store,
  windowQueueKey: string
): Promise<DurableMessageDeliverySnapshot> {
  const records = await readDeliveriesLocked(store);
  return {
    queue: records
      .filter(
        (record): record is DurableQueuedMessage =>
          record.status === "queued" && record.originQueueKey === windowQueueKey
      )
      .map(toQueuedMessage),
    active: records.filter(isActiveDelivery),
  };
}

export function resetMessageQueueDeliveryRecordsForTests(): void {
  legacyQueueMigrationComplete = false;
}
