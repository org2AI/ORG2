/**
 * Shared Language Extension Mapping for CodeMirror
 *
 * Intentionally eager language loading for Diff and ConflictEditor.
 * The regular Editor must use lazyLanguageExtensions instead.
 */
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { StreamLanguage } from "@codemirror/language";
import { dart as dartMode } from "@codemirror/legacy-modes/mode/clike";
import { go as goMode } from "@codemirror/legacy-modes/mode/go";
import { Extension } from "@codemirror/state";

import { getLanguageKey } from "./languageDetection";
import { langCacheSet } from "./languageExtensionCache";

const allLangExtensionCache = new Map<string, Extension>();

/**
 * Get the appropriate CodeMirror language extension based on file path or language.
 * Loads all languages synchronously (for components that don't support async).
 * Results are cached by langKey to avoid recreating extensions.
 */
export function getLanguageExtension(
  filePath?: string,
  language?: string
): Extension | null {
  const langKey = getLanguageKey(filePath, language);
  if (!langKey) return null;

  const cached = allLangExtensionCache.get(langKey);
  if (cached) return cached;

  let ext: Extension | null = null;
  switch (langKey) {
    case "javascript":
      ext = javascript();
      break;
    case "jsx":
      ext = javascript({ jsx: true });
      break;
    case "typescript":
      ext = javascript({ typescript: true });
      break;
    case "tsx":
      ext = javascript({ jsx: true, typescript: true });
      break;
    case "python":
      ext = python();
      break;
    case "java":
      ext = java();
      break;
    case "cpp":
    case "c":
      ext = cpp();
      break;
    case "rust":
      ext = rust();
      break;
    case "html":
      ext = html();
      break;
    case "css":
    case "scss":
      ext = css();
      break;
    case "json":
      ext = json();
      break;
    case "markdown":
      ext = markdown();
      break;
    case "dart":
      ext = StreamLanguage.define(dartMode);
      break;
    case "go":
      ext = StreamLanguage.define(goMode);
      break;
    default:
      return null;
  }

  if (ext) {
    langCacheSet(allLangExtensionCache, langKey, ext);
  }
  return ext;
}
