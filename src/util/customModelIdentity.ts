const PLACEHOLDER_PREFIX = "new-";
const CUSTOM_ROW_ID_PREFIX = "custom-row-";
const MAX_MODEL_ID_BYTES = 256;

export function newCustomRowId(): string {
  return `${CUSTOM_ROW_ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
}

export function newPlaceholderModelName(rowId: string): string {
  return `${PLACEHOLDER_PREFIX}${rowId.slice(CUSTOM_ROW_ID_PREFIX.length)}`;
}

/**
 * Whether `id` is acceptable as a literal request model ID. Mirrors the
 * key-vault `save_key` rule (1–256 bytes, no whitespace or control chars) so
 * the wizard never lets a value through that the backend will reject.
 */
export function isValidCustomModelId(id: string): boolean {
  return (
    id.length > 0 &&
    new TextEncoder().encode(id).length <= MAX_MODEL_ID_BYTES &&
    !/\s|\p{Cc}/u.test(id)
  );
}
