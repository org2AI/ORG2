/**
 * Composer editor snapshot contract.
 *
 * `components/ComposerInput` produces these snapshots and
 * `store/session/creatorDraftAtom` persists them, so the shape lives here
 * rather than in the component. Pure data — no DOM, no React.
 */

/**
 * Icon type for special pill items. Drives icon rendering in `ComposerPill`
 * and how `serializePillNode` formats the agent-side payload.
 */
export type PillIconType =
  | "file"
  | "folder"
  | "terminal"
  | "session"
  | "browser"
  | "repo"
  | "branch"
  | "project"
  | "workitem"
  | "dom-element"
  | "dom-component"
  | "skill"
  | "member"
  | "paste"
  | "link"
  | "pr"
  | "issue";

/**
 * Persisted pill payload. This is the canonical, in-memory description of a
 * pill. The DOM serialization mirrors the same keys via `data-*` attributes
 * so a snapshot round-trip preserves the pill exactly.
 */
export interface ComposerPillAttrs {
  filePath: string;
  fileName: string;
  isFolder: boolean;
  iconType: PillIconType | null;
  lineStart: number | null;
  lineEnd: number | null;
}

/**
 * Opaque snapshot used to round-trip composer state across an in-flight
 * submit so we can restore the editor (text + pills + line ranges) if the
 * request fails. Returned from `getSnapshot()`; consumed by `setContent()`.
 */
export interface ComposerSnapshot {
  /** Linear sequence of text nodes and pill references, in DOM order. */
  parts: Array<
    | { kind: "text"; text: string }
    | { kind: "newline" }
    | { kind: "pill"; attrs: ComposerPillAttrs }
  >;
}
