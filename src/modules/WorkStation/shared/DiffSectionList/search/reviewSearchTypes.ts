export interface ReviewSearchFile {
  path: string;
  oldContent?: string;
  newContent?: string;
  isBinary?: boolean;
  isUnavailable?: boolean;
}
export interface ReviewSearchMatch {
  path: string;
  side: "old" | "new";
  from: number;
  to: number;
}
export const REVIEW_SEARCH_LIMIT = 1000;

export interface ReviewSearchQuery {
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}
