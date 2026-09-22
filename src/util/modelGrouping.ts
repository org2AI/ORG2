/**
 * Model Grouping Utility
 *
 * Groups model names by family prefix (e.g., "Opus 4.6", "GPT 5.3")
 * and sorts groups by version descending (largest first).
 *
 * Also provides era classification:
 * - "current" = latest generation
 * - "older"   = previous generation
 */
import {
  extractGptModelTier,
  isModelVariantSuffixToken,
  stripCursorHostedModelPrefix,
} from "./modelNameGrammar";
import { formatTierModelLabel, isTierModelName } from "./modelTiers";

export interface ModelGroup {
  label: string;
  sortVersion: number;
  models: string[];
}

export const MODEL_GROUP_SORT_MODE = {
  ENABLED_FIRST: "enabled_first",
  ALPHABETICAL: "alphabetical",
} as const;

export type ModelGroupSortMode =
  (typeof MODEL_GROUP_SORT_MODE)[keyof typeof MODEL_GROUP_SORT_MODE];

function groupHasAnyEnabled(
  group: ModelGroup,
  enabledSet: ReadonlySet<string>
): boolean {
  return group.models.some((model) => enabledSet.has(model));
}

// ============================================
// Era thresholds — groups below these are "older"
// ============================================

/** Inclusive minimum versions, with no upper bound for future generations. */
const CURRENT_MINIMUM_VERSIONS: Record<string, readonly [number, number]> = {
  claude: [4, 8],
  gpt: [5, 5],
  gemini: [2, 0],
  sonnet: [4, 8],
  opus: [4, 8],
  haiku: [4, 8],
  fable: [5, 0],
  mythos: [5, 0],
  composer: [1, 5],
  o: [5, 4],
  glm: [5, 1],
  minimax: [2, 7],
};

interface ParsedGroup {
  label: string;
  sortVersion: number;
}

function formatGptTierLabel(tier: string): string {
  return tier
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

/**
 * Group label for a routing-tier id. With a Cursor hint the tier is named for
 * what it does ("Auto (Cursor picks)"); without one the owner is unknown, so
 * the id is only capitalised — see `@src/util/modelTiers`.
 */
function formatTierGroupLabel(modelName: string, agentType?: string): string {
  return (
    formatTierModelLabel(modelName, agentType) ??
    modelName.charAt(0).toUpperCase() + modelName.slice(1)
  );
}

function versionStringToSortVersion(version: string): number {
  const [majorRaw, minorRaw = "0"] = version.split(".");
  const major = Number.parseInt(majorRaw, 10);
  const minor = Number.parseInt(minorRaw, 10);
  return major * 100 + (minorRaw.length === 1 ? minor * 10 : minor);
}

/** Version-extraction patterns tried in order; first match wins. */
const FAMILY_PATTERNS: {
  prefix: string;
  label: string;
  versionRe: RegExp;
}[] = [
  { prefix: "claude", label: "Claude", versionRe: /^claude-?(.+)/ },
  { prefix: "gpt", label: "GPT", versionRe: /gpt-(\d+(?:\.\d+)?)/ },
  { prefix: "gemini", label: "Gemini", versionRe: /gemini-(\d+(?:\.\d+)?)/ },
  { prefix: "sonnet", label: "Sonnet", versionRe: /sonnet-(\d+(?:\.\d+)?)/ },
  { prefix: "opus", label: "Opus", versionRe: /opus-(\d+(?:\.\d+)?)/ },
  {
    prefix: "composer",
    label: "Composer",
    versionRe: /composer-(\d+(?:\.\d+)?)/,
  },
  { prefix: "grok", label: "Grok", versionRe: /grok-?(\d+(?:\.\d+)?)?/ },
  { prefix: "kimi", label: "Kimi", versionRe: /kimi-?k?(\d+(?:\.\d+)?)/ },
  { prefix: "glm", label: "GLM", versionRe: /glm-(\d+(?:\.\d+)?)/ },
  {
    prefix: "minimax",
    label: "MiniMax",
    versionRe: /minimax-?(?:m)?(\d+(?:\.\d+)?)/,
  },
  { prefix: "abab", label: "MiniMax", versionRe: /abab(\d+(?:\.\d+)?)/ },
  { prefix: "o", label: "O", versionRe: /^o(\d+(?:\.\d+)?)/ },
];

/** Anthropic model names that should appear in group labels. */
const CLAUDE_MODEL_NAMES = new Set([
  "sonnet",
  "haiku",
  "opus",
  "fable",
  "mythos",
]);

function parseClaude(rest: string): ParsedGroup {
  const parts = rest.split("-");

  function formatClaudeLabel(version: string): string {
    const modelName = parts.find((p) => CLAUDE_MODEL_NAMES.has(p));
    if (modelName) {
      const modelLabel = modelName.charAt(0).toUpperCase() + modelName.slice(1);
      return `${modelLabel} ${version}`;
    }
    // No canonical Anthropic model name (sonnet / haiku / opus). Surface the
    // first non-numeric, non-empty segment as the codename so unreleased /
    // preview models like `claude-fable-5` show as "Claude Fable 5" instead
    // of getting collapsed to a bare "Claude 5".
    const codename = parts.find(
      (p) => p.length > 0 && !/^\d+(\.\d+)?$/.test(p) && p !== "claude"
    );
    if (codename) {
      const codeLabel = codename.charAt(0).toUpperCase() + codename.slice(1);
      return `Claude ${codeLabel} ${version}`;
    }
    return `Claude ${version}`;
  }

  for (const part of parts) {
    if (/^\d+\.\d+$/.test(part)) {
      const ver = parseFloat(part);
      const major = Math.floor(ver);
      const minor = Math.round((ver % 1) * 10);
      return {
        label: formatClaudeLabel(part),
        sortVersion: major * 100 + minor,
      };
    }
  }

  const integers = parts.filter((p) => /^\d+$/.test(p)).map(Number);
  if (integers.length >= 2) {
    const version = `${integers[0]}.${integers[1]}`;
    return {
      label: formatClaudeLabel(version),
      sortVersion: integers[0] * 100 + integers[1],
    };
  }

  if (integers.length === 1) {
    const version = `${integers[0]}`;
    return {
      label: formatClaudeLabel(version),
      sortVersion: integers[0] * 100,
    };
  }

  return { label: "Claude", sortVersion: 0 };
}

/**
 * Parse a model name and extract a group label + sortable version number.
 *
 * `agentType` only matters for routing-tier ids, whose label depends on who
 * owns them; every other name is self-identifying.
 */
function parseModelGroup(modelName: string, agentType?: string): ParsedGroup {
  const { coreModelName } = stripCursorHostedModelPrefix(modelName);
  const lower = coreModelName.toLowerCase();
  const cleaned = lower.replace(/-\d{8}$/, "").replace(/-latest$/, "");

  if (isTierModelName(cleaned)) {
    return {
      label: formatTierGroupLabel(cleaned, agentType),
      sortVersion: 1000,
    };
  }

  for (const { prefix, label, versionRe } of FAMILY_PATTERNS) {
    if (!cleaned.startsWith(prefix)) continue;

    if (prefix === "claude") {
      const rest = cleaned.replace(/^claude-?/, "");
      return parseClaude(rest);
    }

    if (prefix === "gpt") {
      const versionMatch = cleaned.match(/^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/);
      if (versionMatch?.[1]) {
        const rest = versionMatch[2];
        if (!rest) {
          return {
            label: `${label} ${versionMatch[1]}`,
            sortVersion: versionStringToSortVersion(versionMatch[1]),
          };
        }
        const tier = extractGptModelTier(rest);
        const distinctTokens = tier
          ? rest
              .slice(tier.length)
              .split("-")
              .filter(
                (token) => token.length > 0 && !isModelVariantSuffixToken(token)
              )
          : [];
        const subLabel = tier
          ? ` ${formatGptTierLabel([tier, ...distinctTokens].join("-"))}`
          : "";
        return {
          label: `${label} ${versionMatch[1]}${subLabel}`,
          sortVersion: versionStringToSortVersion(versionMatch[1]),
        };
      }
      return { label, sortVersion: 100 };
    }

    if (prefix === "o") {
      const match = cleaned.match(/^o(\d+(?:\.\d+)?)/);
      if (!match?.[1]) continue;
      return {
        label: `o${match[1]}`,
        sortVersion: versionStringToSortVersion(match[1]),
      };
    }

    const match = cleaned.match(versionRe);
    if (match && match[1]) {
      return {
        label: `${label} ${match[1]}`,
        sortVersion: versionStringToSortVersion(match[1]),
      };
    }
    return { label, sortVersion: 100 };
  }

  return { label: "Other", sortVersion: -1 };
}

/**
 * Group models by family prefix and sort groups by version descending.
 *
 * Pass `agentType` whenever the caller knows which account the ids came from:
 * routing-tier ids ("default", "auto") name no model, so only the owner can
 * say what the group should be called.
 */
export function groupModels(
  models: string[],
  agentType?: string
): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const parsed = parseModelGroup(model, agentType);
    const groupLabel = parsed.label === "Other" ? model : parsed.label;
    const existing = groups.get(groupLabel);
    if (existing) {
      existing.models.push(model);
    } else {
      groups.set(groupLabel, {
        label: groupLabel,
        sortVersion: parsed.sortVersion,
        models: [model],
      });
    }
  }
  return Array.from(groups.values()).sort(
    (groupA, groupB) => groupB.sortVersion - groupA.sortVersion
  );
}

/**
 * Re-derive a group's label once the owning agent is known.
 *
 * Only routing-tier groups ("default", "auto", "premium") can change: every
 * other label is derived from a self-identifying model name. Lets callers that
 * group ids from mixed sources fix up the labels they can attribute, without
 * re-running the grouping pass per account.
 */
export function groupLabelForAgent(
  group: ModelGroup,
  agentType?: string
): string {
  const soleModel = group.models.length === 1 ? group.models[0] : undefined;
  if (!soleModel || !isTierModelName(soleModel)) return group.label;
  return formatTierGroupLabel(soleModel.toLowerCase(), agentType);
}

/** Sort model groups for inline pickers (enabled first or A–Z). */
export function sortModelGroups(
  groups: readonly ModelGroup[],
  sortMode: ModelGroupSortMode,
  enabledSet: ReadonlySet<string>
): ModelGroup[] {
  const copy = [...groups];
  if (sortMode === MODEL_GROUP_SORT_MODE.ALPHABETICAL) {
    return copy.sort((groupA, groupB) =>
      groupA.label.localeCompare(groupB.label, undefined, {
        sensitivity: "base",
      })
    );
  }

  return copy.sort((groupA, groupB) => {
    const enabledDiff =
      Number(groupHasAnyEnabled(groupB, enabledSet)) -
      Number(groupHasAnyEnabled(groupA, enabledSet));
    if (enabledDiff !== 0) return enabledDiff;
    return groupB.sortVersion - groupA.sortVersion;
  });
}

/** True when a model did not match any known family/version pattern. */
export function isUncategorizedModelGroup(group: ModelGroup): boolean {
  return group.sortVersion === -1;
}

/**
 * Returns model IDs that should be enabled by default.
 * Excludes legacy groups and dated snapshot models (e.g. "gpt-5.4-2026-03-17").
 * Used when adding new accounts to pre-select current models.
 */
export function getDefaultEnabledModels(allModels: string[]): string[] {
  const groups = groupModels(allModels);
  const enabled: string[] = [];
  for (const group of groups) {
    if (!isLegacyGroup(group)) {
      for (const model of group.models) {
        if (!modelNameHasSnapshotDate(model)) {
          enabled.push(model);
        }
      }
    }
  }
  return enabled;
}

/** Check whether a model group is "older" (previous generation). */
export function isLegacyGroup(group: ModelGroup): boolean {
  const labelHead = group.label.split(" ")[0].toLowerCase();
  const familyKey = /^o\d/.test(labelHead) ? "o" : labelHead;
  const minimum = CURRENT_MINIMUM_VERSIONS[familyKey];
  if (minimum) {
    // Compare version components rather than the presentation sort score:
    // e.g. 5.10 is newer than 5.5, and every 6.x also clears that minimum.
    const version = group.label.match(/(?:^o| )(\d+)(?:\.(\d+))?/);
    if (!version) return true;
    const major = Number(version[1]);
    const minor = Number(version[2] ?? 0);
    return major < minimum[0] || (major === minimum[0] && minor < minimum[1]);
  }
  return false;
}

/** Maps family prefix → provider-level display label for filter pills. */
const FAMILY_TO_PROVIDER: Record<string, string> = {
  claude: "Claude",
  sonnet: "Claude",
  opus: "Claude",
  gpt: "OpenAI",
  o: "OpenAI",
  composer: "Cursor",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  glm: "Zhipu",
  minimax: "MiniMax",
  abab: "MiniMax",
};

/**
 * Map a model name to a provider-level family label.
 * Returns e.g. "Claude", "OpenAI", "Gemini", "Cursor", or "Other".
 */
export function getModelFamily(modelName: string): string {
  const { coreModelName } = stripCursorHostedModelPrefix(modelName);
  const lower = coreModelName.toLowerCase();
  const cleaned = lower.replace(/-\d{8}$/, "").replace(/-latest$/, "");

  if (isTierModelName(cleaned)) {
    return "Cursor";
  }

  for (const { prefix } of FAMILY_PATTERNS) {
    if (prefix === "o") {
      if (!/^o\d/.test(cleaned)) continue;
    } else if (!cleaned.startsWith(prefix)) {
      continue;
    }
    return FAMILY_TO_PROVIDER[prefix] ?? "Other";
  }
  return "Other";
}

/** ISO date token (YYYY-MM-DD) in model IDs — snapshot / dated variants */
const MODEL_SNAPSHOT_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;

/** True when the model ID includes a dated snapshot suffix (e.g. ...2026-03-17). */
export function modelNameHasSnapshotDate(modelName: string): boolean {
  return MODEL_SNAPSHOT_DATE_PATTERN.test(modelName);
}
