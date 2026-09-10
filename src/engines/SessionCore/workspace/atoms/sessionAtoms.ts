/**
 * Repository state consumed by useRepositoryInfo.
 */
import { atom } from "jotai";

/** Current repository name */
export const repositoryNameAtom = atom<string>("Repo");
repositoryNameAtom.debugLabel = "workspace/repositoryName";

/** Current repository path */
export const repoPathAtom = atom<string>("");
repoPathAtom.debugLabel = "workspace/repoPath";

/** Current repository ID */
export const repositoryIdAtom = atom<string>("");
repositoryIdAtom.debugLabel = "workspace/repositoryId";

/** Whether repository is loading */
export const isRepositoryLoadingAtom = atom<boolean>(false);
isRepositoryLoadingAtom.debugLabel = "workspace/isRepositoryLoading";
