import type { SessionHoverCardContent } from "./SessionHoverCardContent";

type ContentComponent = typeof SessionHoverCardContent;

// Cache executable code only, never session data. All visible owners share at
// most one import; a failed chunk can be retried by the next hover.
let loadedContent: ContentComponent | null = null;
let pendingContent: Promise<ContentComponent> | null = null;

export function getLoadedSessionHoverCardContent(): ContentComponent | null {
  return loadedContent;
}

export function loadSessionHoverCardContent(): Promise<ContentComponent> {
  if (loadedContent) return Promise.resolve(loadedContent);
  if (!pendingContent) {
    pendingContent = import("./SessionHoverCardContent").then(
      (module) => {
        loadedContent = module.SessionHoverCardContent;
        pendingContent = null;
        return loadedContent;
      },
      (error: unknown) => {
        pendingContent = null;
        throw error;
      }
    );
  }
  return pendingContent;
}
