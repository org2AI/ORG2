import React, { useState } from "react";

import type { AgentOrgTask } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { ChevronsDownUpIcon, HugeiconsIcon, UnfoldMoreIcon } from "@src/icons";

export function AgentOrgTaskSubject({
  task,
  done,
}: {
  task: AgentOrgTask;
  done: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = task.subject || task.description;
  const hasLongText = text.length > 120 || text.includes("\n");

  if (!hasLongText) {
    return (
      <span
        className={`chat-block-title min-w-0 text-sm leading-5 text-text-1 ${done ? "text-text-3! line-through" : ""}`}
        title={task.description || task.subject}
      >
        {task.subject}
      </span>
    );
  }

  return (
    <Button
      layout="custom"
      className={`chat-block-title flex min-w-0 flex-1 items-start gap-1 text-left text-sm leading-5 text-text-1 focus-visible:ring-2 focus-visible:ring-primary-6/30 focus-visible:outline-none ${done ? "text-text-3! line-through" : ""}`}
      title={task.description || task.subject}
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
    >
      <span
        className={
          expanded
            ? "max-h-32 min-w-0 flex-1 overflow-y-auto wrap-break-word whitespace-pre-wrap"
            : "min-w-0 flex-1 truncate"
        }
      >
        {text}
      </span>
      {expanded ? (
        <HugeiconsIcon
          icon={ChevronsDownUpIcon}
          data-icon="chevrons-down-up"
          size={11}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-text-3"
        />
      ) : (
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          data-icon="chevrons-up-down"
          size={11}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-text-3"
        />
      )}
    </Button>
  );
}
