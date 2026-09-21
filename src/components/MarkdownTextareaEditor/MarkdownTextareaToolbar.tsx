import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  CodeXmlIcon,
  Heading02Icon,
  HugeiconsIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  ListChecksIcon,
  ListIcon,
  QuoteIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@src/icons";

import type { MarkdownTextareaFormat } from "./formatting";

const TOOLBAR_ICON_SIZE = 14;
const COMPACT_TOOLBAR_CLASS = "min-h-0! border-b-0! pb-0.5! [&_svg]:size-3.5";

interface ToolbarAction {
  format: MarkdownTextareaFormat;
  label: string;
  icon: React.ReactNode;
}

interface MarkdownTextareaToolbarProps {
  canWrite: boolean;
  dataTestId?: string;
  onApplyFormat: (format: MarkdownTextareaFormat) => void;
}

/** Compact formatting toolbar shown above the Write textarea. */
const MarkdownTextareaToolbar: React.FC<MarkdownTextareaToolbarProps> = ({
  canWrite,
  dataTestId,
  onApplyFormat,
}) => {
  const { t } = useTranslation("sessions");

  const actions: ToolbarAction[] = [
    {
      format: "heading",
      label: t("creator.toolbar.heading2"),
      icon: (
        <HugeiconsIcon
          icon={Heading02Icon}
          data-icon="heading-2"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "bold",
      label: t("creator.toolbar.bold"),
      icon: (
        <HugeiconsIcon
          icon={TextBoldIcon}
          data-icon="bold"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "italic",
      label: t("creator.toolbar.italic"),
      icon: (
        <HugeiconsIcon
          icon={TextItalicIcon}
          data-icon="italic"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "strikethrough",
      label: t("creator.toolbar.strikethrough"),
      icon: (
        <HugeiconsIcon
          icon={TextStrikethroughIcon}
          data-icon="strikethrough"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "inlineCode",
      label: t("creator.toolbar.inlineCode"),
      icon: (
        <HugeiconsIcon
          icon={CodeXmlIcon}
          data-icon="code"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "link",
      label: t("creator.toolbar.link"),
      icon: (
        <HugeiconsIcon
          icon={Link01Icon}
          data-icon="link-icon"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "quote",
      label: t("creator.toolbar.quote"),
      icon: (
        <HugeiconsIcon
          icon={QuoteIcon}
          data-icon="quote"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "bulletList",
      label: t("creator.toolbar.bulletList"),
      icon: (
        <HugeiconsIcon
          icon={ListIcon}
          data-icon="list"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "numberedList",
      label: t("creator.toolbar.numberedList"),
      icon: (
        <HugeiconsIcon
          icon={LeftToRightListNumberIcon}
          data-icon="list-ordered"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
    {
      format: "taskList",
      label: t("creator.toolbar.taskList"),
      icon: (
        <HugeiconsIcon
          icon={ListChecksIcon}
          data-icon="list-checks"
          size={TOOLBAR_ICON_SIZE}
        />
      ),
    },
  ];

  return (
    <div
      className={`markdown-formatting-toolbar ${COMPACT_TOOLBAR_CLASS}`}
      role="toolbar"
      aria-label={t("creator.toolbar.formatting", "Text formatting")}
      data-testid={dataTestId ? `${dataTestId}-toolbar` : undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map(({ format, label, icon }) => (
        <Button
          layout="custom"
          key={format}
          className="toolbar-btn"
          title={label}
          aria-label={label}
          disabled={!canWrite}
          data-markdown-format={format}
          onClick={() => onApplyFormat(format)}
        >
          {icon}
        </Button>
      ))}
    </div>
  );
};

export default MarkdownTextareaToolbar;
