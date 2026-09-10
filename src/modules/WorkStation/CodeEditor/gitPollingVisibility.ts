interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Keep the native polling owner empty while its Source Control view is hidden. */
export function trackGitPollingVisibility(
  source: VisibilitySource,
  repoId: string | null | undefined,
  report: (repoId: string | null) => void
): () => void {
  const update = () =>
    report(source.visibilityState === "hidden" ? null : (repoId ?? null));
  source.addEventListener("visibilitychange", update);
  update();
  return () => {
    source.removeEventListener("visibilitychange", update);
    report(null);
  };
}
