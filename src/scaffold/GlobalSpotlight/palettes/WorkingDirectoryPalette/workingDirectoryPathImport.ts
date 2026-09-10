import { homeDir } from "@tauri-apps/api/path";
import { message as showTauriMessage } from "@tauri-apps/plugin-dialog";

import { repoApi } from "@src/api/tauri/repo";

const ABSOLUTE_PATH_PATTERN = /^(?:~\/|\/|[A-Za-z]:[\\/])/;

interface ImportWorkingDirectoryPathArgs {
  candidatePath: string;
  invalidPathTitle: string;
  invalidPathMessage: (path: string) => string;
  onImportWorkingDirectory: (path: string) => Promise<unknown>;
}

export function looksLikeWorkingDirectoryPath(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value.trim());
}

export function getWorkingDirectoryPathCandidate(value: string): string | null {
  const candidatePath = value.trim();
  return looksLikeWorkingDirectoryPath(candidatePath) ? candidatePath : null;
}

export function getWorkingDirectoryPathDisplayName(path: string): string {
  const normalizedPath = path.trim().replace(/[\\/]+$/, "");
  if (!normalizedPath) return path.trim();
  const segments = normalizedPath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? normalizedPath;
}

export async function expandHomePath(path: string): Promise<string> {
  const trimmedPath = path.trim();
  if (!trimmedPath.startsWith("~/")) return trimmedPath;

  const home = await homeDir();
  return `${home.replace(/[\\/]$/, "")}/${trimmedPath.slice(2)}`;
}

async function showInvalidWorkingDirectoryPathDialog(
  title: string,
  dialogMessage: string
): Promise<void> {
  await showTauriMessage(dialogMessage, {
    title,
    kind: "error",
    buttons: { ok: "OK" },
  });
}

export async function importWorkingDirectoryPath({
  candidatePath,
  invalidPathTitle,
  invalidPathMessage,
  onImportWorkingDirectory,
}: ImportWorkingDirectoryPathArgs): Promise<boolean> {
  const workingDirectoryPath = getWorkingDirectoryPathCandidate(candidatePath);
  if (!workingDirectoryPath) return false;

  try {
    const expandedPath = await expandHomePath(workingDirectoryPath);
    const validatedPath = await repoApi.validateWorkspacePath(expandedPath);
    await onImportWorkingDirectory(validatedPath);
    return true;
  } catch {
    await showInvalidWorkingDirectoryPathDialog(
      invalidPathTitle,
      invalidPathMessage(workingDirectoryPath)
    );
    return true;
  }
}
