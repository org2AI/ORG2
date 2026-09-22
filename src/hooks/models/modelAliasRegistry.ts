/**
 * Runtime registry mapping model ids to user-chosen model alias metadata.
 *
 * Populated from key records on app startup and refreshed after key-vault
 * mutations. Consumed by model icons and model label renderers as the
 * highest-priority lookup before model-id inference/formatting.
 */
import { useSyncExternalStore } from "react";

import type { IconProvider } from "@src/components/ModelIcon/config";

interface KeyRecordWithModelAliases {
  id?: string;
  model_aliases?: Array<{
    alias?: string | null;
    display_name?: string | null;
    displayName?: string | null;
    icon?: string | null;
  }>;
}

const modelAliasIconMap = new Map<string, IconProvider>();
const modelAliasDisplayNameMap = new Map<string, string>();
const keyDisplayNames = new Map<string, Map<string, string>>();
const subscribers = new Set<() => void>();
let version = 0;

function notifySubscribers(): void {
  version += 1;
  subscribers.forEach((subscriber) => subscriber());
}

function subscribeModelAliases(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getModelAliasSnapshot(): number {
  return version;
}

export function useModelAliasRegistryVersion(): number {
  return useSyncExternalStore(
    subscribeModelAliases,
    getModelAliasSnapshot,
    getModelAliasSnapshot
  );
}

export function getModelAliasIcon(modelName: string): IconProvider | undefined {
  return modelAliasIconMap.get(modelName);
}

export function getModelAliasDisplayName(
  modelName: string,
  keyId?: string
): string | undefined {
  return keyId
    ? keyDisplayNames.get(keyId)?.get(modelName)
    : modelAliasDisplayNameMap.get(modelName);
}

function sameMap<V>(left: Map<string, V>, right: Map<string, V>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (!right.has(key) || right.get(key) !== value) return false;
  }
  return true;
}

function sameKeyLabels(
  left: Map<string, Map<string, string>>,
  right: Map<string, Map<string, string>>
): boolean {
  if (left.size !== right.size) return false;
  for (const [keyId, labels] of left) {
    const other = right.get(keyId);
    if (!other || !sameMap(labels, other)) return false;
  }
  return true;
}

export function replaceModelAliasesFromKeys(
  keys: KeyRecordWithModelAliases[]
): void {
  const nextIcons = new Map<string, IconProvider>();
  const nextDisplayNames = new Map<string, string>();
  const nextKeyDisplayNames = new Map<string, Map<string, string>>();
  const ambiguous = new Set<string>();
  for (const key of keys) {
    const labels = new Map<string, string>();
    if (key.id) nextKeyDisplayNames.set(key.id, labels);
    for (const alias of key.model_aliases ?? []) {
      if (!alias.alias) continue;
      if (alias.icon) {
        nextIcons.set(alias.alias, alias.icon as IconProvider);
      }
      const displayName = alias.display_name ?? alias.displayName;
      if (displayName?.trim()) {
        labels.set(alias.alias, displayName);
        const previous = nextDisplayNames.get(alias.alias);
        if (previous !== undefined && previous !== displayName)
          ambiguous.add(alias.alias);
        nextDisplayNames.set(alias.alias, displayName);
      }
    }
  }
  for (const model of ambiguous) nextDisplayNames.delete(model);

  // Every ModelIcon and model label in the app subscribes here, so an
  // unchanged rebuild — the common case, since any key write republishes the
  // whole list — must not wake them.
  const unchanged =
    sameMap(nextIcons, modelAliasIconMap) &&
    sameMap(nextDisplayNames, modelAliasDisplayNameMap) &&
    sameKeyLabels(nextKeyDisplayNames, keyDisplayNames);

  modelAliasIconMap.clear();
  for (const [model, icon] of nextIcons) modelAliasIconMap.set(model, icon);
  modelAliasDisplayNameMap.clear();
  for (const [model, name] of nextDisplayNames) {
    modelAliasDisplayNameMap.set(model, name);
  }
  keyDisplayNames.clear();
  for (const [keyId, labels] of nextKeyDisplayNames) {
    keyDisplayNames.set(keyId, labels);
  }

  if (unchanged) return;
  notifySubscribers();
}
