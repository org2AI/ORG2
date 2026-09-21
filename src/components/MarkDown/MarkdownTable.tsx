import React from "react";
import { useTranslation } from "react-i18next";

/** Keep native table layout inside a keyboard-scrollable overflow region. */
export default function MarkdownTable({
  children,
  ...props
}: React.ComponentPropsWithoutRef<"table">) {
  const { t } = useTranslation("common");
  return (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label={t("common.table")}
      tabIndex={0}
    >
      <table {...props}>{children}</table>
    </div>
  );
}
