interface SearchableSettingsItem {
  readonly id: string;
  readonly label: string;
  readonly searchTerms?: readonly string[];
}

interface SearchableSettingsGroup {
  readonly items: readonly SearchableSettingsItem[];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

/** One prepared string per entry; no query history, timers or global cache. */
export function createSettingsSearchIndex<
  TGroup extends SearchableSettingsGroup,
>(groups: readonly TGroup[]): (query: string) => TGroup[] {
  const index = groups.map((group) => ({
    group,
    entries: group.items.map((item) => ({
      item,
      text: normalizeSearchText(
        [item.label, item.id, ...(item.searchTerms ?? [])].join(" ")
      ),
    })),
  }));

  return (query) => {
    const tokens = normalizeSearchText(query)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return index.flatMap(({ group, entries }) => {
      if (tokens.length === 0) return group.items.length > 0 ? [group] : [];
      const items = entries
        .filter(({ text }) => tokens.every((token) => text.includes(token)))
        .map(({ item }) => item);
      return items.length > 0 ? [{ ...group, items }] : [];
    });
  };
}
