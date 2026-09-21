/**
 * The Markdown renderer extension registry.
 *
 * Side-effect free to import: the module only creates an empty record, so a
 * shared module can read it without acquiring anyone's bootstrap timers or
 * fake-timer-sensitive setup. Owning tiers call `registerMarkdownExtensions`
 * once at app bootstrap (`src/app/root/`); reads happen at render time, so a
 * late registration is still picked up by the next render.
 */
import type { MarkdownExtensions } from "./types";

const EMPTY: MarkdownExtensions = Object.freeze({});

let current: MarkdownExtensions = EMPTY;

/**
 * Merge implementations into the registry. Called once per owning tier at
 * bootstrap; later calls override only the slots they name.
 */
export function registerMarkdownExtensions(
  extensions: MarkdownExtensions
): void {
  current = { ...current, ...extensions };
}

/** Current slot implementations. Read at render time, never at module init. */
export function markdownExtensions(): MarkdownExtensions {
  return current;
}

/** Drop every registration. Test-only; production registers once at boot. */
export function resetMarkdownExtensions(): void {
  current = EMPTY;
}
