/** JS/TS are synchronous; all other language parsers load on demand. */
import { javascript } from "@codemirror/lang-javascript";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

import { createLogger } from "@src/hooks/logger";

import { EXT_TO_LANG_MAP } from "./languageDetection";
import { langCacheSet } from "./languageExtensionCache";

const log = createLogger("CodeMirror");

const syncExtensionCache = new Map<string, Extension>();

/**
 * Synchronously get language extension for JS/TS only (always loaded).
 * Use this when you want to lazy-load other languages.
 * Results are cached by langKey to avoid recreating extensions.
 */
export function getLanguageExtensionSync(langKey: string): Extension | null {
  const cached = syncExtensionCache.get(langKey);
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
    default:
      return null;
  }

  if (ext) {
    langCacheSet(syncExtensionCache, langKey, ext);
  }
  return ext;
}

// ============================================
// Lazy Loading for Other Languages
// ============================================

// Cache for loaded language extensions
const languageExtensionCache = new Map<string, Extension>();
// Only known keys enter the in-flight map (at most the finite language registry).
const supportedLanguages = new Set(Object.values(EXT_TO_LANG_MAP));
const inFlight = new Map<string, Promise<Extension | null>>();

export function loadLanguageExtension(
  langKey: string
): Promise<Extension | null> {
  if (!supportedLanguages.has(langKey)) return Promise.resolve(null);
  const cached = languageExtensionCache.get(langKey);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(langKey);
  if (pending) return pending;
  const request = createLanguageExtension(langKey).finally(() => {
    inFlight.delete(langKey);
  });
  inFlight.set(langKey, request);
  return request;
}

/**
 * Lazy load language extension (for non-JS languages).
 */
async function createLanguageExtension(
  langKey: string
): Promise<Extension | null> {
  let ext: Extension | null = null;

  try {
    switch (langKey) {
      case "python": {
        const { python: pythonLang } = await import("@codemirror/lang-python");
        ext = pythonLang();
        break;
      }
      case "java": {
        const { java: javaLang } = await import("@codemirror/lang-java");
        ext = javaLang();
        break;
      }
      case "cpp":
      case "c": {
        const { cpp: cppLang } = await import("@codemirror/lang-cpp");
        ext = cppLang();
        break;
      }
      case "rust": {
        const { rust: rustLang } = await import("@codemirror/lang-rust");
        ext = rustLang();
        break;
      }
      case "html": {
        const { html: htmlLang } = await import("@codemirror/lang-html");
        ext = htmlLang();
        break;
      }
      case "css":
      case "scss": {
        const { css: cssLang } = await import("@codemirror/lang-css");
        ext = cssLang();
        break;
      }
      case "json": {
        const { json: jsonLang } = await import("@codemirror/lang-json");
        ext = jsonLang();
        break;
      }
      case "markdown": {
        const { markdown: mdLang } = await import("@codemirror/lang-markdown");
        ext = mdLang();
        break;
      }
      case "dart": {
        const { dart: dartMode } =
          await import("@codemirror/legacy-modes/mode/clike");
        ext = StreamLanguage.define(dartMode);
        break;
      }
      case "go": {
        const { go: goMode } = await import("@codemirror/legacy-modes/mode/go");
        ext = StreamLanguage.define(goMode);
        break;
      }
    }
  } catch (error) {
    log.warn(
      `[CodeMirror] Failed to load language extension for ${langKey}:`,
      error
    );
    return null;
  }

  if (ext) {
    langCacheSet(languageExtensionCache, langKey, ext);
  }

  return ext;
}
