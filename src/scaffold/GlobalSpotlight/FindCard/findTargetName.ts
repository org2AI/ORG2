/**
 * Find target name clipping
 *
 * Keeps "Search in {{name}}" copy visible in the Find card placeholder when a
 * session or file name is long.
 */

/** Display-width budget for the name; wide glyphs count as 2. */
export const FIND_TARGET_NAME_MAX_WIDTH = 24;

const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

export function clipFindTargetName(
  name: string,
  maxWidth = FIND_TARGET_NAME_MAX_WIDTH
): string {
  let width = 0;
  let head = "";
  for (const char of name) {
    width += WIDE_CHAR.test(char) ? 2 : 1;
    if (width > maxWidth) return `${head.trimEnd()}…`;
    // Leave one cell for the ellipsis.
    if (width < maxWidth) head += char;
  }
  return name;
}
