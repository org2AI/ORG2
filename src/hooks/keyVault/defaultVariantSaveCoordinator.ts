import { saveKey } from "@src/api/services/keyValidation";
import type {
  DefaultVariantInfo,
  KeyInfo,
  SaveKeyRequest,
} from "@src/api/types/keys";

import {
  getSharedLocalKeys,
  subscribeSharedLocalKeys,
  updateSharedLocalKeys,
} from "./sharedLocalKeyStore";

interface Operation {
  choices: DefaultVariantInfo[];
  epochs: Map<string, number>;
  resolve: (key: KeyInfo) => void;
  reject: (error: unknown) => void;
}
interface AccountLane {
  id: string;
  modelType: KeyInfo["agent_type"];
  confirmed: Map<string, string>;
  projected: Map<string, string>;
  owned: Set<string>;
  epochs: Map<string, number>;
  pending: Operation[];
  unsubscribe?: () => void;
}

const MAX_PENDING_PER_ACCOUNT = 64;
const MAX_ACTIVE_ACCOUNTS = 64;
// Only active saves retain a lane/subscription. There are no idle timers.
const lanes = new Map<string, AccountLane>();
const choicesOf = (key: KeyInfo) =>
  new Map(
    (key.default_variants ?? []).map((choice) => [
      choice.base_model,
      choice.model,
    ])
  );
const read = (lane: Pick<AccountLane, "id" | "modelType">) =>
  getSharedLocalKeys().find(
    (key) => key.id === lane.id && key.agent_type === lane.modelType
  );

function assign(
  map: Map<string, string>,
  family: string,
  model: string | undefined
) {
  if (model === undefined) map.delete(family);
  else map.set(family, model);
}

function observe(lane: AccountLane, current: Map<string, string>) {
  for (const family of lane.owned) {
    const model = current.get(family);
    if (
      model === lane.projected.get(family) ||
      model === lane.confirmed.get(family)
    )
      continue;
    if (
      lane.pending.some(
        (operation) =>
          operation.epochs.get(family) === lane.epochs.get(family) &&
          operation.choices.some(
            (choice) => choice.base_model === family && choice.model === model
          )
      )
    )
      continue;
    // An independent edit supersedes older intent for this family only.
    assign(lane.confirmed, family, model);
    lane.epochs.set(family, (lane.epochs.get(family) ?? 0) + 1);
    lane.owned.delete(family);
  }
}

function reconcile(lane: AccountLane) {
  const current = read(lane);
  if (!current) return; // Never recreate a deleted/replaced account.
  const visible = choicesOf(current);
  observe(lane, visible);
  const projected = new Map(visible);
  for (const family of lane.owned)
    assign(projected, family, lane.confirmed.get(family));
  for (const operation of lane.pending) {
    for (const choice of operation.choices) {
      if (
        lane.owned.has(choice.base_model) &&
        operation.epochs.get(choice.base_model) ===
          lane.epochs.get(choice.base_model)
      ) {
        projected.set(choice.base_model, choice.model);
      }
    }
  }
  lane.projected = projected;
  if (
    projected.size === visible.size &&
    [...projected].every(([family, model]) => visible.get(family) === model)
  )
    return;
  updateSharedLocalKeys((keys) =>
    keys.map((key) =>
      key.id === lane.id && key.agent_type === lane.modelType
        ? {
            ...key,
            default_variants: [...projected].map(([base_model, model]) => ({
              base_model,
              model,
            })),
          }
        : key
    )
  );
}

async function drain(lane: AccountLane) {
  try {
    while (lane.pending.length) {
      const operation = lane.pending[0];
      try {
        const before = read(lane);
        if (!before) throw new Error("Account no longer exists");
        const active = operation.choices.filter(
          (choice) =>
            operation.epochs.get(choice.base_model) ===
            lane.epochs.get(choice.base_model)
        );
        const saved = active.length
          ? await saveKey({
              id: lane.id,
              agent_type: lane.modelType,
              default_variant_overrides: active,
            })
          : before;
        // Only this operation's families become confirmed. A returned full
        // row must not replace newer picks or unrelated health/catalog edits.
        const defaults = choicesOf(saved);
        for (const choice of active) {
          if (
            operation.epochs.get(choice.base_model) ===
            lane.epochs.get(choice.base_model)
          ) {
            assign(
              lane.confirmed,
              choice.base_model,
              defaults.get(choice.base_model)
            );
          }
        }
        lane.pending.shift();
        reconcile(lane);
        operation.resolve(read(lane) ?? saved);
      } catch (error) {
        lane.pending.shift();
        reconcile(lane);
        operation.reject(error);
      }
    }
  } finally {
    lane.unsubscribe?.();
    lanes.delete(lane.id);
  }
}

/** All default-pick entry points share this ordered, family-scoped writer. */
export function saveDefaultVariantOverrides(
  request: SaveKeyRequest
): Promise<KeyInfo> {
  if (
    !request.id ||
    !request.default_variant_overrides ||
    Object.entries(request).some(
      ([key, value]) =>
        value !== undefined &&
        !["id", "agent_type", "default_variant_overrides"].includes(key)
    )
  ) {
    return Promise.reject(
      new Error(
        "Default variant overrides require a separate account-scoped request"
      )
    );
  }
  const before = read({ id: request.id, modelType: request.agent_type });
  if (!before) return Promise.reject(new Error("Account no longer exists"));
  if (!request.default_variant_overrides.length) return Promise.resolve(before);
  let lane = lanes.get(request.id);
  if (
    (lane && lane.pending.length >= MAX_PENDING_PER_ACCOUNT) ||
    (!lane && lanes.size >= MAX_ACTIVE_ACCOUNTS)
  ) {
    return Promise.reject(new Error("Too many pending default model changes"));
  }
  const start = !lane;
  if (!lane) {
    lane = {
      id: request.id,
      modelType: request.agent_type,
      confirmed: choicesOf(before),
      projected: choicesOf(before),
      owned: new Set(),
      epochs: new Map(),
      pending: [],
    };
    lanes.set(request.id, lane);
  } else {
    if (lane.modelType !== request.agent_type)
      return Promise.reject(new Error("Account provider changed"));
    observe(lane, choicesOf(before));
  }
  const epochs = new Map<string, number>();
  const choices = request.default_variant_overrides.map((choice) => ({
    ...choice,
  }));
  for (const choice of choices) {
    if (!lane.owned.has(choice.base_model)) {
      assign(
        lane.confirmed,
        choice.base_model,
        choicesOf(before).get(choice.base_model)
      );
    }
    lane.owned.add(choice.base_model);
    const epoch = lane.epochs.get(choice.base_model) ?? 0;
    lane.epochs.set(choice.base_model, epoch);
    epochs.set(choice.base_model, epoch);
  }
  const promise = new Promise<KeyInfo>((resolve, reject) => {
    lane.pending.push({ choices, epochs, resolve, reject });
  });
  if (start) {
    const active = lane;
    lane.unsubscribe = subscribeSharedLocalKeys(() => reconcile(active));
  }
  reconcile(lane);
  if (start)
    drain(lane).catch((error) => {
      for (const operation of lane.pending.splice(0)) operation.reject(error);
    });
  return promise;
}
