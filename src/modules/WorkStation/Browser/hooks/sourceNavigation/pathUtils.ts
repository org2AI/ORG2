function resolveSourcePath(sourcePath: string, repoPath: string): string {
  let cleanPath = sourcePath
    .replace(/^webpack:\/\/\/?/, "")
    .replace(/^vite:\/\/\/?/, "")
    .replace(/^\.\/?/, "");

  if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.replace("file://", "");
  }

  if (cleanPath.startsWith("/")) {
    if (cleanPath.startsWith(repoPath)) {
      return cleanPath;
    }
    const relativePart = cleanPath.replace(/^\/+/, "");
    return `${repoPath}/${relativePart}`;
  }

  return `${repoPath}/${cleanPath}`;
}

export { resolveSourcePath };
