/**
 * Code Search API
 *
 * TypeScript wrappers for live Tauri code search and symbol commands.
 */
export type {
  SearchMatch,
  CodeSearchResult,
  SymbolInfo,
  SymbolSearchResult,
  Location,
  SearchFilters,
  SearchResultEvent,
  SearchCompleteEvent,
} from "./types";

export {
  searchCodeRegex,
  searchCodeStreaming,
  cancelSearch,
  searchCodeFast,
} from "./regex";

export {
  searchSymbols,
  getFileSymbols,
  gotoDefinition,
  findReferences,
} from "./symbol";
