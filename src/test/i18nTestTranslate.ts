/**
 * Test-only `t()` that resolves the real English copy.
 *
 * Product code no longer passes a literal default as `t()`'s second argument —
 * every key resolves, and `check:i18n-keys` keeps it that way — so the old test
 * mock shape (`t: (key, fallback) => fallback`) had nothing left to return.
 * Tests assert on user-visible copy, so resolve the key against the shipped
 * `en` bundle instead of restating the copy inside the test.
 *
 * Supports the subset of i18next that product code actually uses: `ns:key`
 * prefixes, `{{interpolation}}`, and `count` pluralization.
 */
import auth from "@src/i18n/locales/en/auth.json";
import builderProfile from "@src/i18n/locales/en/builderProfile.json";
import common from "@src/i18n/locales/en/common.json";
import geo from "@src/i18n/locales/en/geo.json";
import integrations from "@src/i18n/locales/en/integrations.json";
import market from "@src/i18n/locales/en/market.json";
import mobileRemote from "@src/i18n/locales/en/mobileRemote.json";
import navigation from "@src/i18n/locales/en/navigation.json";
import onboarding from "@src/i18n/locales/en/onboarding.json";
import profile from "@src/i18n/locales/en/profile.json";
import projects from "@src/i18n/locales/en/projects.json";
import sessions from "@src/i18n/locales/en/sessions.json";
import settings from "@src/i18n/locales/en/settings.json";
import teamRuntime from "@src/i18n/locales/en/teamRuntime.json";
import terms from "@src/i18n/locales/en/terms.json";
import workflow from "@src/i18n/locales/en/workflow.json";

type Bundle = Record<string, unknown>;

/** Every shipped English namespace, keyed the way i18next registers them. */
export const EN_RESOURCES: Record<string, Bundle> = {
  auth,
  builderProfile,
  common,
  geo,
  integrations,
  market,
  mobileRemote,
  navigation,
  onboarding,
  profile,
  projects,
  sessions,
  settings,
  teamRuntime,
  terms,
  workflow,
};

export interface TestTranslateOptions {
  count?: number;
  [key: string]: unknown;
}

function lookup(bundle: Bundle, keyPath: string): string | undefined {
  let node: unknown = bundle;
  for (const part of keyPath.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Bundle)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** English plural suffixes, most specific first. */
function pluralKeys(keyPath: string, count: number | undefined): string[] {
  if (count === undefined) return [keyPath];
  return [`${keyPath}_${count === 1 ? "one" : "other"}`, keyPath];
}

function interpolate(value: string, options: TestTranslateOptions): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => {
    const replacement = options[name];
    return replacement === undefined ? match : String(replacement);
  });
}

/**
 * Resolve `key` the way the running app would, and fall back to the key itself
 * so an unresolved key is visible in the assertion rather than silently empty.
 */
export function testTranslate(
  key: string,
  options: TestTranslateOptions = {}
): string {
  const [maybeNs, ...rest] = key.split(":");
  const explicitNs = rest.length > 0 ? maybeNs : undefined;
  const keyPath = rest.length > 0 ? rest.join(":") : key;

  const bundles = explicitNs
    ? [EN_RESOURCES[explicitNs]].filter(Boolean)
    : Object.values(EN_RESOURCES);

  for (const candidate of pluralKeys(keyPath, options.count)) {
    for (const bundle of bundles) {
      const hit = lookup(bundle, candidate);
      if (hit !== undefined) return interpolate(hit, options);
    }
  }
  return key;
}

/**
 * Drop-in for `useTranslation()` in a `vi.mock("react-i18next", …)`. Honours the
 * namespace and `keyPrefix` the component asked for, then falls back to a
 * cross-namespace search so a key borrowed from another bundle still resolves.
 */
export function useTestTranslation(
  ns?: string | string[],
  options?: { keyPrefix?: string }
) {
  const namespace = Array.isArray(ns) ? ns[0] : ns;
  const t = (key: string, opts: TestTranslateOptions = {}) => {
    const prefixed = options?.keyPrefix ? `${options.keyPrefix}.${key}` : key;
    if (namespace && !prefixed.includes(":")) {
      const scoped = testTranslate(`${namespace}:${prefixed}`, opts);
      if (scoped !== `${namespace}:${prefixed}`) return scoped;
    }
    return testTranslate(prefixed, opts);
  };
  return { t, i18n: { language: "en", changeLanguage: () => {} } };
}
