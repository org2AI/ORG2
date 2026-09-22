/**
 * Native browser-webview load phases.
 *
 * Runtime-only evidence of what a native browser webview actually did, keyed by
 * webview label. Written by `BrowserSessionWebview` from the Rust
 * `browser-webview-load-state` event, read by `BrowserCore` to decide whether a
 * pane failed to load.
 *
 * Deliberately NOT part of `BrowserSession`: sessions are persisted wholesale to
 * localStorage, and a restored `finished` phase would claim a page had rendered
 * before its webview existed.
 */
import { atom } from "jotai";

/**
 * `started` — the native webview began a navigation.
 * `finished` — the main frame finished loading, i.e. the pane has content.
 *
 * wry exposes no failure callback, so a `started` that never reaches `finished`
 * is the only signal an embedded load failed.
 */
export type BrowserWebviewLoadPhase = "started" | "finished";

export interface BrowserWebviewLoadState {
  phase: BrowserWebviewLoadPhase;
  /** Final URL the native webview reported for this phase (post-redirect). */
  url: string;
  /** `Date.now()` when the phase was observed. */
  at: number;
}

/** Keyed by native webview label (see `getBrowserSessionWebviewLabel`). */
export type BrowserWebviewLoadStateMap = Readonly<
  Record<string, BrowserWebviewLoadState>
>;

export const browserWebviewLoadStateAtom = atom<BrowserWebviewLoadStateMap>({});
browserWebviewLoadStateAtom.debugLabel = "browserWebviewLoadStateAtom";

/**
 * Reads one webview's phase out of a map value.
 *
 * Tolerates a non-map value because component tests stub `useAtomValue` with a
 * single fallback for every atom.
 */
export function selectWebviewLoadState(
  map: unknown,
  label: string | undefined
): BrowserWebviewLoadState | undefined {
  if (!label || !map || typeof map !== "object") return undefined;
  return (map as Record<string, BrowserWebviewLoadState | undefined>)[label];
}
