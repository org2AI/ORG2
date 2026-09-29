import React from "react";

import { SessionSourcesContent } from "@src/features/SessionSources/SessionSourcesContent";

import type { UnifiedTabContentProps } from "../types";

export default function SessionSourcesTabRenderer({
  tab,
  isActive,
}: UnifiedTabContentProps) {
  const sessionId =
    typeof tab.data.sessionId === "string" ? tab.data.sessionId.trim() : "";
  // Inactive tabs must not read history or resolve thumbnails. Remounting also
  // resets pagination/gallery state when a different conversation owns the tab.
  if (!isActive) return null;
  return <SessionSourcesContent key={sessionId} sessionId={sessionId} />;
}
