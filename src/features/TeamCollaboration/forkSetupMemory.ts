import { z } from "zod/v4";

import type { ForkSessionSetupSelection } from "./forkDialogState";

// V1 had no identity attribution. Do not migrate another user's choices by guessing.
export const FORK_SETUP_STORAGE_KEY = "orgii:fork-setup-memory-v2";
export const MAX_FORK_SETUP_ENTRIES = 128;
export const FORK_SETUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ForkSetupMemoryScope {
  identityKey: string;
  orgId: string;
  sourceSessionId: string;
}
const EntrySchema = z.object({
  workspaceRepoPath: z.string().nullable(),
  execution: z.object({
    agentDefinitionId: z.string().min(1),
    accountId: z.string().min(1),
    model: z.string().min(1),
  }),
  savedAt: z.string(),
});
type ForkSetupMemory = Record<string, z.infer<typeof EntrySchema>>;

function memoryKey(
  repoScopeKey: string | null | undefined,
  scope: ForkSetupMemoryScope
): string {
  const repo = repoScopeKey?.trim();
  return JSON.stringify([
    scope.identityKey,
    scope.orgId,
    repo ? ["repo", repo] : ["session", scope.sourceSessionId],
  ]);
}

/** Prune on access; there is no timer or retained in-memory registry. */
function readAll(): ForkSetupMemory {
  try {
    const raw = window.localStorage.getItem(FORK_SETUP_STORAGE_KEY);
    if (!raw || raw.length > 512 * 1024) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed)
        .flatMap(([key, value]) => {
          const entry = EntrySchema.safeParse(value);
          if (!entry.success) return [];
          const savedAt = Date.parse(entry.data.savedAt);
          if (
            !Number.isFinite(savedAt) ||
            savedAt > now ||
            now - savedAt >= FORK_SETUP_MAX_AGE_MS
          )
            return [];
          return [[key, entry.data] as const];
        })
        .sort((a, b) => Date.parse(b[1].savedAt) - Date.parse(a[1].savedAt))
        .slice(0, MAX_FORK_SETUP_ENTRIES)
    );
  } catch {
    return {};
  }
}

function writeAll(memory: ForkSetupMemory): void {
  try {
    const entries = Object.entries(memory).sort(
      (a, b) => Date.parse(b[1].savedAt) - Date.parse(a[1].savedAt)
    );
    window.localStorage.setItem(
      FORK_SETUP_STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(entries.slice(0, MAX_FORK_SETUP_ENTRIES))
      )
    );
  } catch {
    // Best-effort persistence; the explicit setup dialog remains available.
  }
}

export function loadForkSetupMemory(
  repoScopeKey: string | null | undefined,
  scope: ForkSetupMemoryScope | null
): ForkSessionSetupSelection | null {
  if (!scope) return null;
  const memory = readAll();
  writeAll(memory);
  const entry = memory[memoryKey(repoScopeKey, scope)];
  return entry
    ? { workspaceRepoPath: entry.workspaceRepoPath, execution: entry.execution }
    : null;
}

export function saveForkSetupMemory(
  repoScopeKey: string | null | undefined,
  selection: ForkSessionSetupSelection,
  scope: ForkSetupMemoryScope | null
): void {
  if (!scope) return;
  const entry = EntrySchema.safeParse({
    ...selection,
    savedAt: new Date().toISOString(),
  });
  if (!entry.success) return;
  const key = memoryKey(repoScopeKey, scope);
  // Put the freshly confirmed entry first even when timestamps tie.
  const memory = readAll();
  delete memory[key];
  writeAll({ [key]: entry.data, ...memory });
}

export function clearForkSetupMemory(
  repoScopeKey: string | null | undefined,
  scope: ForkSetupMemoryScope | null
): void {
  if (!scope) return;
  const memory = readAll();
  delete memory[memoryKey(repoScopeKey, scope)];
  writeAll(memory);
}
