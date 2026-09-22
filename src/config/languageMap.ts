/**
 * Compatibility entry point for editor/LSP language detection.
 *
 * The canonical metadata lives in languageRegistry so editor IDs, syntax
 * highlighter IDs, display labels, and icon filenames do not drift apart.
 */
import { LANGUAGE_MAP, getEditorLanguageFromPath } from "./languageRegistry";

export {
  SPECIAL_FILENAMES,
  getLanguageDisplayName,
  getLanguageDisplayNameFromPath,
  getLanguageIconFile,
  getLanguageMetadataFromExtension,
  getSyntaxHighlighterLanguage,
  getSyntaxHighlighterLanguageFromPath,
} from "./languageRegistry";
export { LANGUAGE_MAP };

/** Get the editor/LSP language identifier for a file path. */
export function getLanguageFromPath(
  filePath: string | undefined | null,
  fallback?: string
): string | undefined {
  return getEditorLanguageFromPath(filePath, fallback);
}
