import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CLI_AGENT,
  type CliAgentType,
  type ModelType,
} from "@src/api/tauri/rpc/schemas/validation";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { openOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { createLogger } from "@src/hooks/logger";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { marketActivationErrorCode } from "./activationError";
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

// Match the existing foreground native-owner refresh budget. This bounds only
// the picker wait: the shared authorization/catalog operation stays single-flight.
const CATALOG_WAIT_MS = 30_000;
const catalogLogger = createLogger("MarketPackages");
function waitForCatalog<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const started = Date.now();
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(Error("market_catalog_wait_cancelled"));
    };
    const timer = setTimeout(() => {
      finish();
      catalogLogger.warn(
        `stage=catalog_wait elapsed_ms=${Date.now() - started} code=market_catalog_load_timeout`
      );
      reject(Error("market_catalog_load_timeout"));
    }, CATALOG_WAIT_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(
      (result) => {
        finish();
        resolve(result);
      },
      (error: unknown) => {
        finish();
        reject(error);
      }
    );
  });
}

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
    let status = await loadConnections(store);
    let recovered = false;
    for (;;) {
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
      if (
        !recovered &&
        results.some(
          (result) =>
            result.status === "rejected" &&
            marketActivationErrorCode(result.reason) ===
              "market_reauthorization_required"
        )
      ) {
        // Only retry a read after a definitive authority rejection. Never replay
        // model calls or financial mutations, or turn network failures into login.
        recovered = true;
        // Native invalidates only the rejected persisted credential. Recheck
        // status so a concurrently replaced valid grant is reused, not rotated.
        status = await loadConnections(store);
        continue;
      }
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
    }
  } catch (error) {
    if (!scope.isCurrent()) return { profiles: [], errors: [] };
    throw error;
  } finally {
    scope.dispose();
  }
}

interface ProfileCache {
  owner: string | null;
  value: MarketProfileLoadResult | null;
  expires: number;
  generation: number;
  flight: Promise<MarketProfileLoadResult> | null;
  flightGeneration: number;
  invalidations: WeakSet<Event>;
}
// One bounded cache per application store, rather than sharing users between stores.
const caches = new WeakMap<MarketStore, ProfileCache>();
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
      invalidations: new WeakSet(),
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
  store: MarketStore = getInstrumentedStore(),
  event?: Event
): void {
  const cache = cacheFor(store);
  // All mounted pickers receive the same event. Invalidate once per store,
  // without retaining events or starting requests for closed consumers.
  if (event) {
    if (cache.invalidations.has(event)) return;
    cache.invalidations.add(event);
  }
  cache.value = null;
  cache.generation++;
}
export async function loadCachedMarketExecutionProfiles(
  force = false,
  store: MarketStore = getInstrumentedStore(),
  signal?: AbortSignal
): Promise<MarketProfileLoadResult> {
  if (signal?.aborted) throw Error("market_catalog_wait_cancelled");
  const cache = cacheFor(store);
  if (force) invalidateMarketProfileCache(store);
  if (!cache.owner) return { profiles: [], errors: [] };
  if (cache.value && Date.now() < cache.expires) return cache.value;
  if (cache.flight) {
    if (cache.flightGeneration === cache.generation) return cache.flight;
    await cache.flight.catch(() => undefined);
    return loadCachedMarketExecutionProfiles(false, store, signal);
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
  const waiterRef = useRef<AbortController | null>(null);
  const pendingLoad = useRef<Promise<void> | null>(null);

  const load = useCallback(
    (force = false): Promise<void> => {
      if (force) invalidateMarketProfileCache(store);
      if (!enabled || !ownerKey) return Promise.resolve();
      if (waiterRef.current) return pendingLoad.current ?? Promise.resolve();
      const generation = ++generationRef.current;
      const waiter = new AbortController();
      waiterRef.current = waiter;
      setLoading(true);
      const task = (async () => {
        try {
          const readCurrent = async (): Promise<MarketProfileLoadResult> => {
            for (;;) {
              const revision = cacheFor(store).generation;
              let result: MarketProfileLoadResult;
              try {
                result = await loadCachedMarketExecutionProfiles(
                  false,
                  store,
                  waiter.signal
                );
              } catch (cause) {
                if (
                  waiter.signal.aborted ||
                  generation !== generationRef.current ||
                  store.get(marketOwnerKeyAtom) !== ownerKey ||
                  revision === cacheFor(store).generation
                )
                  throw cause;
                // A newer invalidation supersedes errors as well as old rows.
                continue;
              }
              if (waiter.signal.aborted)
                throw Error("market_catalog_wait_cancelled");
              if (
                generation !== generationRef.current ||
                store.get(marketOwnerKeyAtom) !== ownerKey
              )
                return { profiles: [], errors: [] };
              if (revision === cacheFor(store).generation) return result;
              // An invalidation during this read owns one fresh read, shared by
              // all consumers. Keep the original foreground deadline throughout.
            }
          };
          const result = await waitForCatalog(readCurrent(), waiter.signal);
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
          waiter.abort();
          if (waiterRef.current === waiter) {
            waiterRef.current = null;
            pendingLoad.current = null;
          }
          if (generation === generationRef.current) {
            setLoading(false);
            setHasLoaded(true);
          }
        }
      })();
      pendingLoad.current = task;
      return task;
    },
    [enabled, ownerKey, store]
  );

  const refresh = useCallback(async () => {
    if (
      enabled &&
      ownerKey &&
      error === "market_reauthorization_required" &&
      !store.get(org2CloudAuthAtom)?.oauthClientId
    ) {
      await openOrg2CloudSignIn({
        onSignedIn: () => {
          window.dispatchEvent(new Event(MARKET_PROFILES_CHANGED_EVENT));
        },
      });
      return;
    }
    await load(true);
  }, [enabled, ownerKey, error, store, load]);

  // Observe every transition even when React batches A → B → A into one render.
  useEffect(
    () =>
      store.sub(marketOwnerKeyAtom, () => {
        generationRef.current++;
        waiterRef.current?.abort();
        waiterRef.current = null;
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
      waiterRef.current?.abort();
      waiterRef.current = null;
    };
  }, [enabled, load, ownerRevision]);

  useEffect(() => {
    const handleProfilesChanged = (event: Event) => {
      invalidateMarketProfileCache(store, event);
      load(false).catch(() => undefined);
    };
    // Focus is an on-demand cache read, not a forced refresh. Repeated focus
    // events reuse fresh data or the existing flight and never extend its wait.
    const focused = () => {
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
