/**
 * Repo Store Derived Atoms
 *
 * Computed/derived atoms that depend on core atoms.
 */
import { atom } from "jotai";

import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import {
  activeFolderIdAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import {
  cachedReposAtom,
  repoFilterAtom,
  reposAtom,
  selectedRepoIdAtom,
} from "./atoms";
import { matchRepoByPath, normalizeRepoPath } from "./matchRepoByPath";
import { REPO_KIND, type Repo } from "./types";

function repoPath(repo: Repo | undefined): string {
  return repo?.path ?? repo?.fs_uri ?? "";
}

// ============================================
// Repo Lookups
// ============================================

/** Map for O(1) repo lookups by ID */
export const repoMapAtom = atom<Map<string, Repo>>((get) => {
  const repos = get(reposAtom);
  return new Map(repos.map((repo) => [repo.id, repo]));
});
repoMapAtom.debugLabel = "repoMapAtom";

export const selectedRepoAtom = atom<Repo | undefined>((get) => {
  const selectedId = get(selectedRepoIdAtom);
  if (!selectedId) return undefined;

  const mainRepo = get(repoMapAtom).get(selectedId);
  if (mainRepo) return mainRepo;

  const cachedRepo = get(cachedReposAtom).find(
    (repo) => repo.id === selectedId
  );
  if (!cachedRepo) return undefined;

  return {
    id: cachedRepo.id,
    name: cachedRepo.name,
    path: cachedRepo.path,
    fs_uri: cachedRepo.path,
    repo_url: cachedRepo.repo_url,
    kind: REPO_KIND.GIT,
  } as Repo;
});
selectedRepoAtom.debugLabel = "selectedRepoAtom";

export const selectedRepoPathAtom = atom<string>((get) => {
  return repoPath(get(selectedRepoAtom));
});
selectedRepoPathAtom.debugLabel = "selectedRepoPathAtom";

// ============================================
// Filtered & Search
// ============================================

/** Filtered repos by search term */
export const filteredReposAtom = atom((get) => {
  const repos = get(reposAtom);
  const filter = get(repoFilterAtom);
  if (!filter) return repos;
  return repos.filter((repo) =>
    repo.name.toLowerCase().includes(filter.toLowerCase())
  );
});
filteredReposAtom.debugLabel = "filteredReposAtom";

/**
 * When the active WorkStation session's repo differs from the currently
 * selected My Station workspace/root, returns the matching target so the
 * status bar can show a "Switch to <name>" hint button.
 *
 * Returns `null` when:
 * - no active session, or the session has no repoPath
 * - the session repo already matches the current workspace
 * - the session repo is not found in the known repos or workspace folders
 */
export const sessionRepoHintAtom = atom<
  | {
      type: "repo";
      repoId: string;
      repoName: string;
    }
  | {
      type: "folder";
      folderId: string;
      folderName: string;
      repoId?: string;
    }
  | null
>((get) => {
  const activeSessionId = get(workstationActiveSessionIdAtom);
  if (!activeSessionId) return null;

  const sessions = get(sessionsAtom);
  const session = sessions.find((s) => s.session_id === activeSessionId);
  const sessionRepoPath = session?.repoPath;
  if (!sessionRepoPath) return null;

  const repos = get(reposAtom);
  const folders = get(workspaceFoldersAtom);
  if (folders.length > 1) {
    const normalizedSessionPath = normalizeRepoPath(sessionRepoPath);
    const folderMatch = folders.find(
      (folder) => normalizeRepoPath(folder.path) === normalizedSessionPath
    );

    if (folderMatch) {
      const currentFolderId =
        get(activeFolderIdAtom) ??
        folders.find((folder) => folder.isPrimary)?.id ??
        folders[0]?.id;
      if (folderMatch.id === currentFolderId) return null;

      const repoMatch =
        (folderMatch.repoId
          ? repos.find((repo) => repo.id === folderMatch.repoId)
          : undefined) ?? matchRepoByPath(repos, folderMatch.path);
      return {
        type: "folder",
        folderId: folderMatch.id,
        folderName: repoMatch?.name ?? folderMatch.name,
        repoId: repoMatch?.id ?? folderMatch.repoId,
      };
    }
  }

  const selectedId = get(selectedRepoIdAtom);
  const match = matchRepoByPath(repos, sessionRepoPath);

  if (!match) return null;
  if (match.id === selectedId) return null;

  return { type: "repo", repoId: match.id, repoName: match.name };
});
sessionRepoHintAtom.debugLabel = "sessionRepoHintAtom";
