import React from "react";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

/** Centered authentication card; optional onboarding lives in the feature modal. */
export default function LoginCard({ content }: { content: React.ReactNode }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-auto p-6">
      <div
        data-tauri-drag-region
        className="pointer-events-auto absolute inset-0 z-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        aria-hidden
      />
      <div
        className={`relative z-10 flex h-full max-h-[560px] w-full flex-col overflow-auto rounded-2xl bg-bg-2 shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
          {content}
        </div>
      </div>
    </div>
  );
}
