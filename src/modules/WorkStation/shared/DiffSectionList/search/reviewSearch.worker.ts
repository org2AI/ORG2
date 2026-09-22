import { SearchQuery } from "@codemirror/search";

import { searchReview } from "./reviewSearch";
import type { ReviewSearchFile } from "./reviewSearchTypes";

let files: ReviewSearchFile[] = [];
self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "files") {
    files = message.files;
    return;
  }
  try {
    const selected = message.path
      ? files.filter((f) => f.path === message.path)
      : files;
    self.postMessage({
      id: message.id,
      matches: searchReview(selected, new SearchQuery(message.query)),
    });
  } catch {
    self.postMessage({ id: message.id, matches: [], error: true });
  }
};
