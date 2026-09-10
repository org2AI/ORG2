/** Lightweight filename and explicit-language detection; no parser imports. */
export const EXT_TO_LANG_MAP: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "cpp",
  hpp: "cpp",
  rs: "rust",
  go: "go",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  dart: "dart",
};

// ============================================
// Language Key Detection
// ============================================

/**
 * Get language key from file path or language prop
 */
export function getLanguageKey(
  filePath?: string,
  language?: string
): string | null {
  if (language) {
    return language.toLowerCase();
  }
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (ext) {
      return EXT_TO_LANG_MAP[ext] || null;
    }
  }
  return null;
}
