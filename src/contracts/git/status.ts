/**
 * Git file-status vocabulary.
 *
 * The status unions are named by `config/gitStatus` (presentation mapping),
 * `types/git/types`, `store/git` and several WorkStation surfaces, so they
 * live here. The color/letter/label mapping itself stays in `config/gitStatus`.
 */

/**
 * Git file status as returned by backend API
 */
export type GitApiStatus =
  | "M"
  | "A"
  | "D"
  | "R"
  | "C"
  | "U"
  | "?"
  | "!"
  | string;

/**
 * Normalized git file status used in frontend
 */
export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "conflict"
  | "ignored";

/**
 * Display status letter (VSCode style)
 * I = Ignored (dimmed, low opacity)
 */
export type GitStatusLetter = "M" | "U" | "A" | "D" | "R" | "C" | "I" | "?";
