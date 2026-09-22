import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { CodeBlockToolbar } from "@src/components/MarkDown/CodeBlockToolbar";
import { useSyntaxHighlight } from "@src/hooks/code/useSyntaxHighlight";

import { useMobileCopyText } from "./useMobileCopyText";

const MAX_HIGHLIGHT_CHARACTERS = 20_000;

export const PortableCodeBlock = memo(function PortableCodeBlock({
  code,
  language,
  streaming,
}: {
  code: string;
  language: string;
  streaming: boolean;
}) {
  const { t } = useTranslation("common");
  const { state: copyState, copy } = useMobileCopyText(code);
  const html = useSyntaxHighlight(code, {
    lang: language,
    enabled: !streaming && code.length <= MAX_HIGHLIGHT_CHARACTERS,
  });

  const label =
    copyState === "copied"
      ? t("status.copied")
      : copyState === "pending"
        ? t("status.loading")
        : t("actions.copy");
  return (
    <div className="code-block-wrapper" data-mobile-code-block="">
      <CodeBlockToolbar
        touch
        copyLabel={label}
        copied={copyState === "copied"}
        pending={copyState === "pending"}
        onCopy={copy}
      />
      {copyState === "failed" && (
        <div role="alert" className="px-3 text-danger-6">
          {t("status.copyFailed")}
        </div>
      )}
      <pre className="prism-html m-0 overflow-x-auto p-3">
        <code
          className={`language-${language}`}
          {...(html
            ? { dangerouslySetInnerHTML: { __html: html } }
            : { children: code })}
        />
      </pre>
    </div>
  );
});
