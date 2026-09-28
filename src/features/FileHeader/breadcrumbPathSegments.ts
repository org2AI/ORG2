import { toFsPluginPath } from "@src/util/file/pathUtils";

export interface FileBreadcrumbPathSegment {
  label: string;
  fullPath: string;
  isLast: boolean;
}

function normalizePath(path: string): string {
  const normalized = toFsPluginPath(path).replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function joinFromAbsoluteRoot(path: string, partialPath: string): string {
  if (/^[A-Za-z]:\//.test(path)) return partialPath;
  return path.startsWith("//") ? `//${partialPath}` : `/${partialPath}`;
}

/**
 * Build navigable breadcrumb paths from the file's owning filesystem path.
 *
 * A tab may point at an agent worktree outside the currently selected repo.
 * In that case the absolute file path remains authoritative; prefixing the
 * selected repo would create a path that cannot exist.
 */
export function buildFileBreadcrumbPathSegments(
  filePath: string,
  repoPath?: string
): FileBreadcrumbPathSegment[] {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedRepoPath = repoPath ? normalizePath(repoPath) : "";
  const absoluteFilePath = isAbsolutePath(normalizedFilePath);
  const fileIsInsideRepo = Boolean(
    normalizedRepoPath &&
    (normalizedFilePath === normalizedRepoPath ||
      normalizedFilePath.startsWith(`${normalizedRepoPath}/`))
  );
  const useRepoRoot = Boolean(
    normalizedRepoPath && (!absoluteFilePath || fileIsInsideRepo)
  );
  const displayPath = fileIsInsideRepo
    ? normalizedFilePath.slice(normalizedRepoPath.length).replace(/^\/+/, "")
    : normalizedFilePath;
  const labels = displayPath.split("/").filter(Boolean);

  return labels.map((label, index) => {
    const partialPath = labels.slice(0, index + 1).join("/");
    const fullPath = useRepoRoot
      ? normalizedRepoPath === "/"
        ? `/${partialPath}`
        : `${normalizedRepoPath}/${partialPath}`
      : absoluteFilePath
        ? joinFromAbsoluteRoot(normalizedFilePath, partialPath)
        : partialPath;

    return {
      label,
      fullPath,
      isLast: index === labels.length - 1,
    };
  });
}
