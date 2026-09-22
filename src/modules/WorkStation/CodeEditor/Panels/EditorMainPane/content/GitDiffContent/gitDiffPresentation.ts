/**
 * Pure derivations `GitDiffContent` makes from a resolved diff before it
 * picks a branch: the paths shown / copied, the preview type, and the
 * binary / empty-content classification.
 */
import type { GitFile } from "@src/types/git/types";
import { isBinaryByExtension } from "@src/util/file/binaryDetection";
import { type PreviewType, getPreviewType } from "@src/util/file/previewTypes";

export interface GitDiffPresentation {
  absoluteFilePath: string;
  isBinary: boolean;
  isBinaryPreviewType: boolean;
  newContentEmpty: boolean;
  oldContentEmpty: boolean;
  previewType: PreviewType;
  relativePath: string;
}

export function resolveGitDiffPresentation(
  effectiveGitFile: GitFile,
  repoPath: string
): GitDiffPresentation {
  const effectiveRepoPath = effectiveGitFile.repoRoot ?? repoPath;
  const absoluteFilePath = effectiveGitFile.path.startsWith("/")
    ? effectiveGitFile.path
    : `${effectiveRepoPath}/${effectiveGitFile.path}`;
  const relativePath = effectiveGitFile.path.startsWith(effectiveRepoPath + "/")
    ? effectiveGitFile.path.slice(effectiveRepoPath.length + 1)
    : effectiveGitFile.path;

  // getPreviewType drives all binary routing — single source of truth
  const previewType = getPreviewType(effectiveGitFile.path);
  const isBinaryPreviewType =
    previewType !== "code" &&
    previewType !== "markdown" &&
    previewType !== "html" &&
    previewType !== "json" &&
    previewType !== "csv";

  // File not found or empty content (VSCode-style error)
  // Only show error if BOTH old and new are empty (file doesn't exist at either point)
  const oldContentEmpty =
    !effectiveGitFile.oldContent || effectiveGitFile.oldContent.trim() === "";
  const newContentEmpty =
    !effectiveGitFile.newContent || effectiveGitFile.newContent.trim() === "";

  // A file is binary if the diff cache set the sentinel OR the extension is binary
  const isBinaryFile =
    effectiveGitFile.oldContent === "Binary file - content not displayed" ||
    effectiveGitFile.newContent === "Binary file - content not displayed";
  const isBinary = isBinaryFile || isBinaryByExtension(effectiveGitFile.path);

  return {
    absoluteFilePath,
    isBinary,
    isBinaryPreviewType,
    newContentEmpty,
    oldContentEmpty,
    previewType,
    relativePath,
  };
}
