export interface TranscriptViewportAnchor {
  itemId: string;
  offsetFromViewportTop: number;
}

/** Geometry belongs to the committed list; reader intent belongs to the viewport. */
export type TranscriptNavigationGeometry =
  | { status: "missing" }
  | { status: "pending"; scrollTop?: number }
  | {
      status: "measured";
      revision: number;
      scrollTop: number;
      anchor: TranscriptViewportAnchor;
    };

export type TranscriptNavigationEnd =
  | "settled"
  | "superseded"
  | "user"
  | "scope"
  | "missing"
  | "follow"
  | "unmount";

export interface TranscriptNavigationTarget {
  id: string;
  /** Destination page. Expansion changes layout, not this scope. */
  scopeKey: string;
  readGeometry: () => TranscriptNavigationGeometry;
  onEnd?: (reason: TranscriptNavigationEnd) => void;
}

export type BeginTranscriptNavigation = (
  target: TranscriptNavigationTarget
) => number;

export function chatNavigationScopeKey(
  sessionId: string | null,
  pageIndex: number | null
): string {
  return JSON.stringify([sessionId, pageIndex]);
}
