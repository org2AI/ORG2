// Cache is bounded by the closed set of language keys in EXT_TO_LANG_MAP
// (~15 entries). Max-size guard protects against future uncontrolled growth.
const LANG_CACHE_MAX = 64;

export function langCacheSet<T>(
  cache: Map<string, T>,
  key: string,
  value: T
): void {
  if (cache.size >= LANG_CACHE_MAX) {
    cache.delete(cache.keys().next().value ?? "");
  }
  cache.set(key, value);
}
