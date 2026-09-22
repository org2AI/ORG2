/**
 * Local-file interception for rendered Markdown.
 *
 * A surface that serves a *remote* session's files (shared sessions, team
 * inbox comments) must not let a `file://`-style markdown reference fall
 * through to the reader's own disk. It provides an interceptor here; the
 * renderer consults it before opening or decoding any local path.
 *
 * The context lives beside the renderer rather than in the feature that
 * provides it, so the renderer stays a leaf. The default — no provider — is
 * ordinary local behaviour.
 */
import { createContext, useContext } from "react";

/** Returns true when it handled the path; false lets local handling proceed. */
export type MarkdownLocalFileInterceptor = (path: string) => boolean;

export const MarkdownLocalFileInterceptContext =
  createContext<MarkdownLocalFileInterceptor | null>(null);

const NEVER_INTERCEPTS: MarkdownLocalFileInterceptor = () => false;

/** True while a provider is serving local references from somewhere else. */
export function useMarkdownLocalFileIntercepted(): boolean {
  return useContext(MarkdownLocalFileInterceptContext) !== null;
}

/** The active interceptor, or a no-op outside a provider. */
export function useMarkdownLocalFileInterceptor(): MarkdownLocalFileInterceptor {
  return useContext(MarkdownLocalFileInterceptContext) ?? NEVER_INTERCEPTS;
}
