import Ansi from "ansi-to-react";
import React, { useMemo } from "react";

import { processAnsiContent } from "@src/engines/TerminalCore/components/TerminalDisplay/utils/ansiProcessor";

import type { MobileShellDetail } from "./mobileToolPresentation";

interface MobileTerminalDetailProps extends MobileShellDetail {
  isLoading: boolean;
  isFailed: boolean;
  truncated: boolean;
  truncatedLabel: string;
}

/** iOS counterpart to Desktop's TerminalBlock content presentation. */
export function MobileTerminalDetail({
  command,
  output,
  exitCode,
  isLoading,
  isFailed,
  truncated,
  truncatedLabel,
}: MobileTerminalDetailProps) {
  const processedOutput = useMemo(() => processAnsiContent(output), [output]);
  const state = isFailed ? "failed" : isLoading ? "running" : "done";

  return (
    <section
      className="mobile-terminal-detail"
      data-mobile-tool-detail-kind="shell"
      data-mobile-tool-detail-state={state}
    >
      <div className="mobile-terminal-detail__frame">
        {command ? (
          <div className="mobile-terminal-detail__command">
            <span className="mobile-terminal-detail__prompt" aria-hidden="true">
              $
            </span>
            <pre>{command}</pre>
          </div>
        ) : null}
        {output ? (
          <pre
            className="mobile-terminal-detail__output"
            aria-live={isLoading ? "polite" : undefined}
          >
            <Ansi>{processedOutput}</Ansi>
          </pre>
        ) : null}
        {!isLoading && exitCode !== undefined && exitCode !== 0 ? (
          <div className="mobile-terminal-detail__exit">exit {exitCode}</div>
        ) : null}
      </div>
      {truncated ? (
        <p className="mobile-terminal-detail__truncated mobile-type-caption text-text-3">
          {truncatedLabel}
        </p>
      ) : null}
    </section>
  );
}

MobileTerminalDetail.displayName = "MobileTerminalDetail";
