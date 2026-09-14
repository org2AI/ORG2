/**
 * Zod schemas for diff/patch Tauri commands.
 *
 * Output schemas describe the camelCase result after snakeToCamel.
 * Input option structs keep Rust snake_case field names.
 */
import { z } from "zod/v4";

// ============================================================================
// Value objects
// ============================================================================

export const DiffAlgorithmSchema = z.union([
  z.literal("myers"),
  z.literal("patience"),
  z.literal("lcs"),
]);

export const DiffOptionsSchema = z.object({
  algorithm: DiffAlgorithmSchema.optional(),
  context_lines: z.number().optional(),
  format: z.literal("unified").optional(),
});

export const DiffStatsSchema = z.object({
  linesAdded: z.number(),
  linesRemoved: z.number(),
  linesUnchanged: z.number(),
  hunks: z.number(),
});

export const DiffResultSchema = z.object({
  diff: z.string(),
  stats: DiffStatsSchema,
  processingTimeUs: z.number(),
});

export const HunkFailureSchema = z.object({
  hunkIndex: z.number(),
  expectedLine: z.number(),
  reason: z.string(),
});

export const PatchResultSchema = z.object({
  content: z.string(),
  success: z.boolean(),
  hunksApplied: z.number(),
  hunksFailed: z.array(HunkFailureSchema),
  processingTimeUs: z.number(),
});

export const FuzzyPatchOptionsSchema = z.object({
  fuzz_factor: z.number().optional(),
  min_similarity: z.number().optional(),
  ignore_whitespace: z.boolean().optional(),
});

export const HunkResultSchema = z.object({
  hunkIndex: z.number(),
  offsetApplied: z.number(),
  similarity: z.number(),
  applied: z.boolean(),
  reason: z.string().nullable(),
});

export const FuzzyPatchResultSchema = z.object({
  content: z.string(),
  success: z.boolean(),
  hunks: z.array(HunkResultSchema),
  processingTimeUs: z.number(),
});

export const MergeResultSchema = z.object({
  content: z.string(),
  clean: z.boolean(),
  conflictCount: z.number(),
  processingTimeUs: z.number(),
});

// ============================================================================
// Procedure inputs
// ============================================================================

export const ComputeDiffInput = z.object({
  oldText: z.string(),
  newText: z.string(),
  oldLabel: z.string().optional(),
  newLabel: z.string().optional(),
  options: DiffOptionsSchema.optional(),
});

export const ApplyPatchInput = z.object({
  original: z.string(),
  patch: z.string(),
});

export const ApplyFuzzyPatchInput = z.object({
  original: z.string(),
  patch: z.string(),
  options: FuzzyPatchOptionsSchema.optional(),
});

export const MergeThreeWayInput = z.object({
  base: z.string(),
  ours: z.string(),
  theirs: z.string(),
  oursLabel: z.string().optional(),
  theirsLabel: z.string().optional(),
});

// ============================================================================
// Static types
// ============================================================================

export type DiffStats = z.infer<typeof DiffStatsSchema>;

export type MergeResult = z.infer<typeof MergeResultSchema>;
