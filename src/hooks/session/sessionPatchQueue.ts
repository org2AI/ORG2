import type { Session } from "@src/store/session/sessionAtom/types";

export interface SessionPatchOptions {
  name?: string;
  model?: string;
  accountId?: string;
  agentExecMode?: string;
  productMode?: string;
  draftText?: string | null;
  replyTargetEventId?: string | null;
  pinned?: boolean;
}

type PatchFields = Partial<Pick<Session, keyof SessionPatchOptions>>;
// These pairs are domain identities. Observing or rolling back only half of a
// pair can create a combination that neither the user nor the server selected.
const fieldGroups: readonly (readonly (keyof SessionPatchOptions)[])[] = [
  ["model", "accountId"],
  ["productMode", "agentExecMode"],
  ["name"],
  ["draftText"],
  ["replyTargetEventId"],
  ["pinned"],
];
interface PendingPatch {
  options: SessionPatchOptions;
  fields: PatchFields;
  resolve: () => void;
  reject: (error: unknown) => void;
}
interface PendingSession {
  confirmed: Session;
  projected: Session;
  owned: Set<keyof SessionPatchOptions>;
  pending: PendingPatch[];
  unsubscribe?: () => void;
}

function patchFields(options: SessionPatchOptions): PatchFields {
  return Object.fromEntries(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        value === null ||
        ((key === "draftText" || key === "replyTargetEventId") && value === "")
          ? undefined
          : value,
      ])
  ) as PatchFields;
}

/**
 * One ordered write stream per session. Pending intent stays optimistic, but
 * rejected writes are replayed from the last confirmed fields, never from a
 * newer optimistic snapshot. The map contains in-flight work only.
 */
export function createSessionPatchQueue(owner: {
  read: (id: string) => Session | undefined;
  publish: (session: Session) => void;
  persist: (id: string, patch: SessionPatchOptions) => Promise<void>;
  subscribe?: (id: string, changed: () => void) => () => void;
}) {
  const sessions = new Map<string, PendingSession>();

  function observe(state: PendingSession, current: Session) {
    for (const group of fieldGroups) {
      if (!group.some((key) => state.owned.has(key))) continue;
      const matches = (row: Session) =>
        group.every((key) => current[key] === row[key]);
      if (matches(state.projected)) continue;
      // RPC account-switch events arrive before the RPC resolves. Their
      // earlier accepted pair must not hide a later optimistic pick.
      let candidate = state.confirmed;
      if (matches(candidate)) continue;
      const expectedEcho = state.pending.some((operation) => {
        candidate = { ...candidate, ...operation.fields };
        return matches(candidate);
      });
      if (expectedEcho) continue;
      for (const key of group) {
        state.confirmed = { ...state.confirmed, [key]: current[key] };
        state.owned.delete(key);
      }
    }
  }

  function reconcile(id: string, state: PendingSession) {
    const current = owner.read(id);
    if (!current) return; // Never resurrect a deleted session.
    observe(state, current);
    const projected = state.pending.reduce(
      (row, operation) => ({ ...row, ...operation.fields }),
      state.confirmed
    );
    const fields = Object.fromEntries(
      [...state.owned].map((key) => [key, projected[key]])
    );
    state.projected = { ...current, ...fields };
    if (
      Object.entries(fields).some(
        ([key, value]) => current[key as keyof Session] !== value
      )
    ) {
      owner.publish(state.projected);
    }
  }

  async function drain(id: string, state: PendingSession) {
    while (state.pending.length > 0) {
      const operation = state.pending[0];
      try {
        if (!owner.read(id)) throw new Error(`Session ${id} no longer exists`);
        if (!state.confirmed.importedFrom) {
          await owner.persist(id, operation.options);
        }
        state.confirmed = { ...state.confirmed, ...operation.fields };
        state.pending.shift();
        reconcile(id, state);
        operation.resolve();
      } catch (error) {
        state.pending.shift();
        reconcile(id, state);
        operation.reject(error);
      }
    }
    state.unsubscribe?.();
    sessions.delete(id);
  }

  return (id: string, options: SessionPatchOptions): Promise<void> => {
    const before = owner.read(id);
    if (!before)
      return Promise.reject(new Error(`Session ${id} not in local store`));
    const fields = patchFields(options);
    let state = sessions.get(id);
    if (
      !state &&
      Object.entries(fields).every(
        ([key, value]) => before[key as keyof Session] === value
      )
    )
      return Promise.resolve();
    if (state && state.pending.length >= 64) {
      return Promise.reject(new Error("Too many pending session changes"));
    }
    const start = !state;
    if (!state) {
      state = {
        confirmed: before,
        projected: before,
        owned: new Set(),
        pending: [],
      };
      sessions.set(id, state);
    } else {
      observe(state, before);
    }
    const promise = new Promise<void>((resolve, reject) => {
      state.pending.push({ options, fields, resolve, reject });
    });
    for (const group of fieldGroups) {
      if (
        !group.some((key) => Object.prototype.hasOwnProperty.call(fields, key))
      )
        continue;
      for (const key of group) {
        if (!state.owned.has(key)) {
          state.confirmed = { ...state.confirmed, [key]: before[key] };
        }
        state.owned.add(key);
      }
    }
    state.projected = { ...before, ...fields };
    if (start) {
      const active = state;
      state.unsubscribe = owner.subscribe?.(id, () => reconcile(id, active));
    }
    owner.publish(state.projected);
    if (start) void drain(id, state);
    return promise;
  };
}
