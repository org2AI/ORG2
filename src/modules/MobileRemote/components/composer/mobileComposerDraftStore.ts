import { MAX_CHAT_IMAGES } from "@src/store/ui/chatImageAtom";

import type {
  MobileConnectionConfig,
  MobileConnectionState,
} from "../../connection/types";

export interface MobileComposerImage {
  id: string;
  dataUrl: string;
  fileName: string;
}

export const MOBILE_DRAFT_LIMIT = 20;
export const MOBILE_DRAFT_TEXT_LIMIT = 100_000;
export const MOBILE_DRAFT_IMAGE_BUDGET = 16 * 1024 * 1024;

export interface MobileComposerDraft {
  text: string;
  textRevision: number;
  images: MobileComposerImage[];
  processing: boolean;
  submitting: boolean;
  imageError?: string;
  submitError?: string;
}

const EMPTY: MobileComposerDraft = {
  text: "",
  textRevision: 0,
  images: [],
  processing: false,
  submitting: false,
};
interface Entry {
  snapshot: MobileComposerDraft;
}
type Update = (draft: MobileComposerDraft) => MobileComposerDraft;
const imageSize = (draft: MobileComposerDraft) =>
  draft.images.reduce(
    (size, image) => size + 2 * (image.dataUrl.length + image.fileName.length),
    0
  );

export function mobileComposerDesktopScope(
  config: MobileConnectionConfig | null,
  connection: Pick<MobileConnectionState, "desktopId">
) {
  let endpoint = "";
  try {
    if (config?.wsUrl) {
      const url = new URL(config.wsUrl);
      endpoint = `${url.origin}${url.pathname}`;
    }
  } catch {
    // Invalid configs cannot connect, but must not share another config's draft.
    // This key remains private in memory (never logged or persisted).
    endpoint = JSON.stringify(["invalid-endpoint", config?.wsUrl]);
  }
  return JSON.stringify([
    config?.desktopId ?? connection.desktopId,
    endpoint,
    config?.host,
    config?.port,
  ]);
}

/** Memory-only navigation drafts. Never persisted to disk or sent to Cloud. */
export function createMobileComposerDraftStore() {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => listeners.get(key)?.forEach((fn) => fn());
  const remove = (key: string) => {
    entries.delete(key);
    notify(key);
  };
  const imageBytes = () =>
    Array.from(entries.values()).reduce(
      (total, entry) => total + imageSize(entry.snapshot),
      0
    );
  const trim = (currentKey: string) => {
    for (const key of entries.keys()) {
      if (
        entries.size <= MOBILE_DRAFT_LIMIT &&
        imageBytes() <= MOBILE_DRAFT_IMAGE_BUDGET
      )
        break;
      if (key !== currentKey && !listeners.has(key)) remove(key);
    }
  };
  const ensure = (key: string) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { snapshot: EMPTY };
      entries.set(key, entry);
      trim(key);
      if (entries.size > MOBILE_DRAFT_LIMIT) {
        entries.delete(key);
        throw new RangeError("Too many active mobile drafts");
      }
    }
    return entry;
  };
  const write = (key: string, entry: Entry, update: Update) => {
    if (entries.get(key) !== entry) return;
    const next = update(entry.snapshot);
    const protectedImageBytes = Array.from(entries).reduce(
      (size, [otherKey, other]) =>
        size +
        (otherKey !== key && listeners.has(otherKey)
          ? imageSize(other.snapshot)
          : 0),
      0
    );
    if (
      next.text.length > MOBILE_DRAFT_TEXT_LIMIT ||
      next.images.length > MAX_CHAT_IMAGES ||
      imageSize(next) + protectedImageBytes > MOBILE_DRAFT_IMAGE_BUDGET
    ) {
      throw new RangeError("Mobile draft exceeds its memory budget");
    }
    entry.snapshot = {
      ...next,
      textRevision:
        entry.snapshot.textRevision +
        (next.text === entry.snapshot.text ? 0 : 1),
    };
    entries.delete(key);
    entries.set(key, entry);
    trim(key);
    notify(key);
  };
  return {
    clear() {
      for (const key of Array.from(entries.keys())) remove(key);
    },
    clearDesktop(desktopScope: string) {
      const prefix = `${JSON.stringify([desktopScope]).slice(0, -1)},`;
      for (const key of Array.from(entries.keys()))
        if (key.startsWith(prefix)) remove(key);
    },
    scope(key: string) {
      return {
        getSnapshot: () => entries.get(key)?.snapshot ?? EMPTY,
        subscribe(fn: () => void) {
          const entry = entries.get(key);
          if (entry) {
            entries.delete(key);
            entries.set(key, entry);
          }
          let subscribers = listeners.get(key);
          if (!subscribers) {
            subscribers = new Set();
            listeners.set(key, subscribers);
          }
          subscribers.add(fn);
          return () => {
            subscribers.delete(fn);
            if (!subscribers.size) listeners.delete(key);
          };
        },
        update: (update: Update) => write(key, ensure(key), update),
        capture: () => ensure(key),
        isCurrent: (entry: Entry) => entries.get(key) === entry,
        updateIfCurrent: (entry: Entry, update: Update) =>
          write(key, entry, update),
      };
    },
  };
}

export type MobileComposerDraftStore = ReturnType<
  typeof createMobileComposerDraftStore
>;
export type MobileComposerDraftHandle = ReturnType<
  MobileComposerDraftStore["scope"]
>;
