import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CLI_AGENT,
  type CliAgentType,
  type ModelType,
} from "@src/api/tauri/rpc/schemas/validation";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { MARKET_PROFILES_CHANGED_EVENT } from "./events";
import {
  type MarketStore,
  captureMarketOwner,
  marketConnectionMatchesOwner,
  marketOwnerKeyAtom,
} from "./identity";
import { marketProfileLabel } from "./profileLabels";
import type { ManagedService } from "./rpc";
import {
  type Connection,
  type Entry,
  loadConnections,
  loadEntries,
  prepareSessionSource,
} from "./rpc";
import { authorizedProfile } from "./usageAuthorization";

export type MarketProfileAgent = "claude_code" | "codex";
export type MarketConnectionTarget =
  | MarketProfileAgent
  | "claude_desktop"
  | "org2";

/**
 * Application-facing reference to a reusable connection. This deliberately
 * lives outside the persisted provider-profile v1 format: older ORG2 builds
 * still require `keyId` there and can continue reading that catalog.
 */
export type ConnectionSourceRef =
  | { kind: "key_vault"; keyId: string }
  | {
      kind: "market";
      connection: Connection;
      entitlementWorkspaceId: string;
      entitlementId: string;
    };

/** Buyer-safe option used by app selectors. Internal ids remain values only. */
export interface ConnectionOption {
  id: string;
  title: string;
  sourceRef: ConnectionSourceRef;
  modelsByTarget: Record<MarketConnectionTarget, string[]>;
  modelCount: number;
  duplicateOrdinal: number | null;
  duplicateCount: number;
  profile: MarketExecutionProfile;
}

/**
 * A managed Market service adapted to ORG2's existing execution-profile UI.
 * It deliberately contains no API key. `connection` plus the entitlement
 * identifiers are only used to ask the backend for an opaque credentialSource.
 */
export interface MarketExecutionProfile {
  managed?: ManagedService;
  id: string;
  label: string;
  connection: Connection;
  entitlementWorkspaceId: string;
  entitlementId: string;
  serviceId: string;
  modelsByAgent: Record<MarketProfileAgent, string[]>;
  expiresAt: number | null;
}

export interface MarketProfileSource {
  id: string;
  label: string;
  modelType: ModelType;
  cliAgentType?: MarketProfileAgent;
  modelIds: string[];
  profile: MarketExecutionProfile;
}

function isActiveEntry(entry: Entry, now: number): boolean {
  return (
    entry.status === "active" &&
    (entry.expires_at === null || entry.expires_at > now)
  );
}

/** Pure adapter shared by the native model picker and external-app settings. */
export function adaptMarketEntries(
  connection: Connection,
  entries: Entry[],
  now = Date.now()
): MarketExecutionProfile[] {
  return entries
    .filter((entry) => isActiveEntry(entry, now))
    .map((entry) => ({
      id: `market:${connection.identity_user_id}:${entry.managed?.service_id ?? entry.entitlement_id}`,
      managed: entry.managed,
      label: entry.service_name,
      connection,
      entitlementWorkspaceId: entry.workspace_id,
      entitlementId: entry.entitlement_id,
      serviceId: entry.service_id,
      modelsByAgent: {
        claude_code: [...new Set(entry.models_by_agent.claude)],
        codex: [...new Set(entry.models_by_agent.codex)],
      },
      expiresAt: entry.expires_at,
    }));
}

/** Keep one purchase even if a stale duplicate ORG2 connection is present. */
export function dedupeMarketProfiles(
  profiles: MarketExecutionProfile[]
): MarketExecutionProfile[] {
  const byEntitlement = new Map<string, MarketExecutionProfile>();
  for (const profile of profiles) {
    if (!byEntitlement.has(profile.id)) {
      byEntitlement.set(profile.id, profile);
    }
  }
  return [...byEntitlement.values()];
}

function modelsForTarget(
  profile: MarketExecutionProfile,
  target: MarketConnectionTarget
): string[] {
  if (profile.managed)
    return profile.managed.models
      .filter((model) => model.clients.includes(target))
      .map((model) => model.model);
  if (target === "claude_code" || target === "claude_desktop") {
    return [...profile.modelsByAgent.claude_code];
  }
  if (target === "codex") return [...profile.modelsByAgent.codex];
  return [
    ...new Set([
      ...profile.modelsByAgent.claude_code,
      ...profile.modelsByAgent.codex,
    ]),
  ];
}

/**
 * Project purchases into the shared Connection selector contract. Every
 * entitlement remains independent. Duplicate titles are distinguished only by
 * structured, non-identifying facts so the UI can localize their presentation.
 */
export function marketConnectionOptions(
  profiles: MarketExecutionProfile[],
  target?: MarketConnectionTarget
): ConnectionOption[] {
  const compatibleProfiles = target
    ? profiles.filter((profile) => modelsForTarget(profile, target).length > 0)
    : profiles;
  const titleCounts = new Map<string, number>();
  for (const profile of compatibleProfiles) {
    titleCounts.set(profile.label, (titleCounts.get(profile.label) ?? 0) + 1);
  }
  const titlePositions = new Map<string, number>();

  return compatibleProfiles.map((profile) => {
    const modelsByTarget: Record<MarketConnectionTarget, string[]> = {
      claude_code: modelsForTarget(profile, "claude_code"),
      claude_desktop: modelsForTarget(profile, "claude_desktop"),
      codex: modelsForTarget(profile, "codex"),
      org2: modelsForTarget(profile, "org2"),
    };
    const duplicateCount = titleCounts.get(profile.label) ?? 1;
    const duplicateOrdinal = (titlePositions.get(profile.label) ?? 0) + 1;
    titlePositions.set(profile.label, duplicateOrdinal);
    return {
      id: profile.id,
      title: profile.label,
      sourceRef: {
        kind: "market" as const,
        connection: profile.connection,
        entitlementWorkspaceId: profile.entitlementWorkspaceId,
        entitlementId: profile.entitlementId,
      },
      modelsByTarget,
      modelCount: modelsByTarget.org2.length,
      duplicateOrdinal: duplicateCount > 1 ? duplicateOrdinal : null,
      duplicateCount,
      profile,
    };
  });
}

export function marketSourcesForAgent(
  profiles: MarketExecutionProfile[],
  cliAgentType: CliAgentType | string | null | undefined
): MarketProfileSource[] {
  const agent: MarketProfileAgent | null =
    cliAgentType === CLI_AGENT.CLAUDE_CODE
      ? "claude_code"
      : cliAgentType === CLI_AGENT.CODEX
        ? "codex"
        : null;
  if (cliAgentType === "rust_agent") {
    return profiles.flatMap((profile) => {
      // Native execution uses the protocol declared by the managed Package;
      // legacy entitlements do not supply this authoritative protocol metadata.
      const models =
        profile.managed?.models.filter(
          (model) =>
            model.clients.includes("org2") &&
            (model.protocol === "anthropic_messages" ||
              model.protocol === "openai_responses")
        ) ?? [];
      if (models.length === 0) return [];
      return [
        {
          id: `${profile.id}:rust_agent`,
          label: marketProfileLabel(profile, profiles),
          modelType:
            models[0].protocol === "anthropic_messages"
              ? ("anthropic_api" as const)
              : ("openai_api" as const),
          modelIds: [...new Set(models.map((model) => model.model))],
          profile,
        },
      ];
    });
  }
  if (!agent) return [];

  return profiles.flatMap((profile) => {
    const modelIds = profile.modelsByAgent[agent];
    if (modelIds.length === 0) return [];
    return [
      {
        id: `${profile.id}:${agent}`,
        label: marketProfileLabel(profile, profiles),
        modelType: agent as ModelType,
        cliAgentType: agent,
        modelIds,
        profile,
      },
    ];
  });
}

export function findMarketSourceForRecent(
  sources: MarketProfileSource[],
  entry: Pick<
    RecentModelEntry,
    "marketProfileId" | "accountName" | "cliAgentType" | "modelId"
  >
): MarketProfileSource | undefined {
  return sources.find(
    (source) =>
      (entry.marketProfileId
        ? source.profile.id === entry.marketProfileId
        : source.label === entry.accountName) &&
      source.cliAgentType === entry.cliAgentType &&
      source.modelIds.includes(entry.modelId)
  );
}

/** UI provider hint follows the selected model; native routing revalidates it. */
export function marketSourceModelType(
  source: MarketProfileSource,
  model: string
): ModelType {
  if (source.cliAgentType) return source.modelType;
  const selected = source.profile.managed?.models.find(
    (item) => item.model === model
  );
  return selected?.protocol === "anthropic_messages"
    ? "anthropic_api"
    : "openai_api";
}

export async function prepareMarketProfileSource(
  source: MarketProfileSource,
  model: string
): Promise<{ credentialSource: string }> {
  if (!source.modelIds.includes(model)) {
    throw new Error(`Market profile does not support model: ${model}`);
  }
  const owner = captureMarketOwner(source.profile.connection.identity_user_id);
  try {
    const profile = await authorizedProfile(source.profile, model);
    owner.assertCurrent();
    const prepared = await prepareSessionSource(
      profile.connection,
      profile.entitlementWorkspaceId,
      profile.entitlementId,
      source.cliAgentType ?? "rust_agent",
      model
    );
    owner.assertCurrent();
    return {
      credentialSource: prepared.credential_source,
    };
  } finally {
    owner.dispose();
  }
}

export interface MarketProfileLoadResult {
  profiles: MarketExecutionProfile[];
  errors: unknown[];
}

export async function loadMarketExecutionProfilesWithDiagnostics(
  store: MarketStore = getInstrumentedStore()
): Promise<MarketProfileLoadResult> {
  const ownerKey = store.get(marketOwnerKeyAtom);
  if (!ownerKey) return { profiles: [], errors: [] };
  const scope = captureMarketOwner(
    ownerKey.slice(ownerKey.lastIndexOf("|") + 1),
    store
  );
  try {
    const status = await loadConnections(store);
    if (!scope.isCurrent()) return { profiles: [], errors: [] };
    const connections = status.connections.filter(
      (connection) =>
        connection.target === "org2" &&
        connection.phase === "authorization_saved" &&
        marketConnectionMatchesOwner(connection.identity_user_id, ownerKey)
    );
    const results = await Promise.allSettled(
      connections.map(async (connection) =>
        adaptMarketEntries(connection, await loadEntries(connection, store))
      )
    );
    if (!scope.isCurrent()) return { profiles: [], errors: [] };
    return {
      profiles: dedupeMarketProfiles(
        results.flatMap((result) =>
          result.status === "fulfilled" ? result.value : []
        )
      ),
      errors: results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      ),
    };
  } catch (error) {
    if (!scope.isCurrent()) return { profiles: [], errors: [] };
    throw error;
  } finally {
    scope.dispose();
  }
}

export async function loadMarketExecutionProfiles(): Promise<
  MarketExecutionProfile[]
> {
  const result = await loadMarketExecutionProfilesWithDiagnostics();
  if (result.errors.length > 0) throw result.errors[0];
  return result.profiles;
}

interface ProfileCache {
  owner: string | null;
  value: MarketProfileLoadResult | null;
  expires: number;
  generation: number;
  flight: Promise<MarketProfileLoadResult> | null;
  flightGeneration: number;
}
// One bounded cache per application store, rather than sharing users between stores.
const caches = new WeakMap<MarketStore, ProfileCache>();
// Several mounted pickers share a store and receive the same focus event.
// Invalidate once so later listeners do not discard the first listener's load.
const focusEvents = new WeakMap<MarketStore, Event>();
function cacheFor(store: MarketStore): ProfileCache {
  let cache = caches.get(store);
  if (!cache) {
    cache = {
      owner: store.get(marketOwnerKeyAtom),
      value: null,
      expires: 0,
      generation: 0,
      flight: null,
      flightGeneration: 0,
    };
    const owned = cache;
    // Store-lifetime narrow subscription: no timer, request, or token-refresh work.
    store.sub(marketOwnerKeyAtom, () => {
      owned.owner = store.get(marketOwnerKeyAtom);
      owned.value = null;
      owned.generation++;
    });
    caches.set(store, cache);
  }
  return cache;
}
export function invalidateMarketProfileCache(
  store: MarketStore = getInstrumentedStore()
): void {
  const cache = cacheFor(store);
  cache.value = null;
  cache.generation++;
}
export async function loadCachedMarketExecutionProfiles(
  force = false,
  store: MarketStore = getInstrumentedStore()
): Promise<MarketProfileLoadResult> {
  const cache = cacheFor(store);
  if (force) invalidateMarketProfileCache(store);
  if (!cache.owner) return { profiles: [], errors: [] };
  if (cache.value && Date.now() < cache.expires) return cache.value;
  if (cache.flight) {
    if (cache.flightGeneration === cache.generation) return cache.flight;
    await cache.flight.catch(() => undefined);
    return loadCachedMarketExecutionProfiles(false, store);
  }
  const generation = cache.generation;
  cache.flightGeneration = generation;
  const request = loadMarketExecutionProfilesWithDiagnostics(store).then(
    (result) => {
      if (generation !== cache.generation) return { profiles: [], errors: [] };
      cache.value = result;
      cache.expires = Date.now() + 30_000;
      return result;
    }
  );
  cache.flight = request;
  try {
    return await request;
  } finally {
    if (cache.flight === request) cache.flight = null;
  }
}

/**
 * Loads Market profiles while a picker needs them. Returning from the website
 * refreshes the account catalog without requiring a custom-protocol handoff.
 */
const EMPTY_PROFILES: MarketExecutionProfile[] = [];

export function useMarketExecutionProfiles(options: {
  enabled: boolean;
  cliAgentType?: CliAgentType | string | null;
}) {
  const { enabled, cliAgentType } = options;
  const store = useStore();
  const ownerKey = useAtomValue(marketOwnerKeyAtom);
  const resultOwner = useRef(ownerKey);
  const [ownerRevision, setOwnerRevision] = useState(0);
  const [profiles, setProfiles] = useState<MarketExecutionProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (force) invalidateMarketProfileCache(store);
      if (!enabled || !ownerKey) return;
      const generation = ++generationRef.current;
      setLoading(true);
      try {
        const result = await loadCachedMarketExecutionProfiles(false, store);
        if (generation !== generationRef.current) return;
        if (store.get(marketOwnerKeyAtom) !== ownerKey) return;
        resultOwner.current = ownerKey;
        setProfiles(result.profiles);
        setError(
          result.errors.length > 0
            ? result.errors
                .map((cause) =>
                  cause instanceof Error ? cause.message : String(cause)
                )
                .join("; ")
            : null
        );
      } catch (cause) {
        if (
          generation !== generationRef.current ||
          store.get(marketOwnerKeyAtom) !== ownerKey
        )
          return;
        resultOwner.current = ownerKey;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (generation === generationRef.current) {
          setLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [enabled, ownerKey, store]
  );

  const refresh = useCallback(async () => load(true), [load]);

  // Observe every transition even when React batches A → B → A into one render.
  useEffect(
    () =>
      store.sub(marketOwnerKeyAtom, () => {
        generationRef.current++;
        resultOwner.current = null;
        setOwnerRevision((revision) => revision + 1);
      }),
    [store]
  );

  useEffect(() => {
    generationRef.current++;
    setProfiles([]);
    setError(null);
    setLoading(false);
    setHasLoaded(false);
  }, [ownerKey, ownerRevision]);

  useEffect(() => {
    if (!enabled) return;
    const requestGeneration = generationRef;
    load(false).catch(() => undefined);
    return () => {
      requestGeneration.current++;
    };
  }, [enabled, load, ownerRevision]);

  useEffect(() => {
    const handleProfilesChanged = () => {
      load(true).catch(() => undefined);
    };
    const focused = (event: Event) => {
      if (focusEvents.get(store) !== event) {
        focusEvents.set(store, event);
        invalidateMarketProfileCache(store);
      }
      if (enabled) load(false).catch(() => undefined);
    };
    window.addEventListener("focus", focused);
    window.addEventListener(
      MARKET_PROFILES_CHANGED_EVENT,
      handleProfilesChanged
    );
    return () => {
      window.removeEventListener("focus", focused);
      window.removeEventListener(
        MARKET_PROFILES_CHANGED_EVENT,
        handleProfilesChanged
      );
    };
  }, [enabled, load, store]);

  const currentOwner = !!ownerKey && resultOwner.current === ownerKey;
  const visibleProfiles = currentOwner ? profiles : EMPTY_PROFILES;
  const sources = useMemo(
    () => marketSourcesForAgent(visibleProfiles, cliAgentType),
    [visibleProfiles, cliAgentType]
  );

  return {
    profiles: visibleProfiles,
    sources,
    loading: !!ownerKey && enabled && (loading || !hasLoaded || !currentOwner),
    error: currentOwner ? error : null,
    refresh,
  };
}
