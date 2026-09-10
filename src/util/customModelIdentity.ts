const PLACEHOLDER_PREFIX = "new-";
const CUSTOM_ROW_ID_PREFIX = "custom-row-";

export function newCustomRowId(): string {
  return `${CUSTOM_ROW_ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
}

export function newPlaceholderModelName(rowId: string): string {
  return `${PLACEHOLDER_PREFIX}${rowId.slice(CUSTOM_ROW_ID_PREFIX.length)}`;
}

/** True when a model name is a placeholder for an unnamed new row. */
export function isPlaceholderModelName(name: string): boolean {
  return name.startsWith(PLACEHOLDER_PREFIX);
}
