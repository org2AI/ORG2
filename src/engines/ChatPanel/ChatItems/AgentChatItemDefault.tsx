import Button from "@/src/components/Button";
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import Markdown from "@src/components/MarkDown";
import { isThemeCssPathDark } from "@src/config/appearance/globalThemes";
import { themesAtom } from "@src/store/ui/uiAtom";

interface AgentChatItemProps {
  children: string;
  handleResultClick?: () => void;
  title?: string;
  streamHtml?: boolean;
  /** Container width for code block diff view */
  codeBlockContainerWidth?: number;
  /** Current check status (for showing result indicator) */
  curCheckStatus?: string;
}
const AgentChatItemDefault: React.FC<AgentChatItemProps> = ({
  children,
  handleResultClick,
  title,
  streamHtml,
  codeBlockContainerWidth,
  curCheckStatus,
}) => {
  const themes = useAtomValue(themesAtom);
  const isStreaming = Boolean(streamHtml);

  return (
    <div className="box-border flex w-full flex-row items-stretch self-stretch">
      <div className="relative flex min-w-0 flex-1 flex-col items-start gap-2">
        <div
          className="chat-text relative flex flex-col items-start gap-3 self-stretch text-text-1"
          data-testid="chat-message-assistant"
        >
          <div className="resultBgc allow-select w-full overflow-visible font-normal wrap-break-word">
            {isStreaming ? (
              children?.length > 0 ? (
                <Markdown
                  textContent={children}
                  useChatCodeBlock={true}
                  codeBlockContainerWidth={codeBlockContainerWidth}
                  enableFileNavigation={false}
                  streaming
                  skipPreprocess={true}
                />
              ) : (
                <span className="text-text-3"> </span>
              )
            ) : (
              <Markdown
                textContent={children || ""}
                useChatCodeBlock={true}
                codeBlockContainerWidth={codeBlockContainerWidth}
                enableFileNavigation={true}
                skipPreprocess={true}
                sessionReferencesAsCards
              />
            )}

            {handleResultClick &&
              (curCheckStatus === title ? (
                <div
                  className={`chat-text-sm mt-3 mr-3 flex h-6 w-24 items-center justify-center rounded-[1.75rem] border border-solid border-primary-5 bg-primary-1 ${
                    isThemeCssPathDark(themes)
                      ? "text-text-1"
                      : "text-primary-5"
                  } `}
                >
                  <p>{"Result"}</p>
                </div>
              ) : (
                <div>
                  <Button
                    onClick={handleResultClick}
                    className="chat-text-sm mt-3 mb-1 h-[24px] rounded-[100px] py-[2px]"
                  >
                    {"Result"}
                  </Button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(AgentChatItemDefault);
