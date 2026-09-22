/**
 * Recent Model Selections Atom
 *
 * Persists the last N model+source selections to localStorage.
 * Each entry captures the full context (model, account, agent type, source type)
 * so the "Recent" tab can offer one-click re-selection without a second step.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import {
  type CliAgentType,
  CliAgentTypeSchema,
  type ModelType,
  ModelTypeSchema,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE, type KeySource } from "@src/api/tauri/session/index";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";
import { getModelVariantBaseModel } from "@src/util/modelVariants";

const STORAGE_KEY = "orgii:recentModelEntries";
const MAX_RECENT = 5;

export interface RecentModelEntry {
  modelId: string;
  sourceType: KeySource;
  accountId?: string;
  accountName?: string;
  credentialSource?: string;
  marketProfileId?: string;
  modelType: ModelType;
  cliAgentType?: CliAgentType;
  cliAgentLabel?: string;
  cliModelDisplay?: string;
}

const marketProfileIdSchema = z.string().startsWith("market:").max(512);

export const RecentModelEntrySchema = z.object({
  modelId: z.string(),
  sourceType: z.enum([KEY_SOURCE.OWN, KEY_SOURCE.HOSTED]),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  credentialSource: z.string().startsWith("market:").max(1024).optional(),
  marketProfileId: marketProfileIdSchema.optional(),
  modelType: ModelTypeSchema,
  cliAgentType: CliAgentTypeSchema.optional(),
  cliAgentLabel: z.string().optional(),
  cliModelDisplay: z.string().optional(),
}) as z.ZodType<RecentModelEntry, RecentModelEntry>;

const RecentModelEntriesSchema = z
  .array(RecentModelEntrySchema)
  .transform((entries) => entries.slice(0, MAX_RECENT));

export const recentModelEntriesAtom = atomWithStorage<RecentModelEntry[]>(
  STORAGE_KEY,
  [],
  createZodJsonStorage(RecentModelEntriesSchema)
);

type MarketSelectionIdentity = Pick<
  RecentModelEntry,
  "credentialSource" | "marketProfileId" | "cliAgentType"
> & { modelType?: ModelType };

/** UI identity only; selecting a Package still prepares fresh credentials. */
export function marketSelectionsEquivalent(
  left: MarketSelectionIdentity,
  right: MarketSelectionIdentity
): boolean {
  const validProfileId = (id: string | undefined) =>
    marketProfileIdSchema.safeParse(id).success;
  if (
    left.credentialSource?.startsWith("market:") &&
    right.credentialSource?.startsWith("market:") &&
    validProfileId(left.marketProfileId) &&
    validProfileId(right.marketProfileId)
  ) {
    return (
      left.marketProfileId === right.marketProfileId &&
      (left.cliAgentType ?? left.modelType) ===
        (right.cliAgentType ?? right.modelType)
    );
  }
  // Old saved selections lack a stable profile id. Keep their exact-source
  // identity instead of guessing from a Package's non-unique display name.
  return left.credentialSource === right.credentialSource;
}

/**
 * Whether two recent entries represent the same account + model selection.
 * Variants of one model family (effort/fast) are the same selection: the row
 * renders the family and edits its variant in place.
 */
export function recentEntriesEquivalent(
  left: RecentModelEntry,
  right: RecentModelEntry
): boolean {
  if (
    getModelVariantBaseModel(left.modelId) !==
      getModelVariantBaseModel(right.modelId) ||
    left.sourceType !== right.sourceType
  ) {
    return false;
  }

  if (left.credentialSource || right.credentialSource) {
    return marketSelectionsEquivalent(left, right);
  }

  if (left.accountId && right.accountId) {
    return left.accountId === right.accountId;
  }

  const leftModelType = left.cliAgentType ?? left.modelType;
  const rightModelType = right.cliAgentType ?? right.modelType;
  if (leftModelType !== rightModelType) {
    return false;
  }

  if (left.accountName && right.accountName) {
    return left.accountName === right.accountName;
  }

  return (
    !left.accountId &&
    !right.accountId &&
    !left.accountName &&
    !right.accountName
  );
}

/**
 * Record a model+source selection. Dedupes by model+account identity, keeps max N.
 */
export function recordRecentEntry(
  current: RecentModelEntry[],
  entry: RecentModelEntry
): RecentModelEntry[] {
  const filtered = current.filter(
    (existing) => !recentEntriesEquivalent(existing, entry)
  );
  return [entry, ...filtered].slice(0, MAX_RECENT);
}

export function findRecentByCredentialSource(
  entries: RecentModelEntry[],
  credentialSource: string | undefined
): RecentModelEntry | undefined {
  if (!credentialSource) return undefined;
  return entries.find((entry) => entry.credentialSource === credentialSource);
}
