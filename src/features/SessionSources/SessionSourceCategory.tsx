import { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import { useCollapsible } from "@src/hooks/ui/useCollapsible";

import { SessionSourceRow } from "./SessionSourceRow";
import { SessionToolActivityGroup } from "./SessionToolActivityGroup";

const PAGE_SIZE = 30;

/** Category-local intent survives refresh and collapse; the session-keyed parent
 * owns remount/reset. Collapsed rows unmount so thumbnails do no hidden work. */
export function SessionSourceCategory({
  kind,
  title,
  items,
  onOpenSource,
}: {
  kind: SessionSource["kind"];
  title: string;
  items: SessionSource[];
  onOpenSource: (source: SessionSource) => void;
}) {
  const { t } = useTranslation();
  const { isOpen, toggle } = useCollapsible();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  return (
    <section aria-label={title} data-source-category={kind}>
      <SidebarSectionHeader
        surface="panel"
        title={title}
        expanded={isOpen}
        onToggle={toggle}
        titleSuffix={
          <span className="text-xs text-text-3">{items.length}</span>
        }
      />
      {isOpen ? (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.slice(0, visibleCount).map((source) => (
              <li key={source.key}>
                {source.kind === "tool-group" ? (
                  <SessionToolActivityGroup
                    source={source}
                    onOpenSource={onOpenSource}
                  />
                ) : (
                  <SessionSourceRow
                    source={source}
                    onOpenSource={onOpenSource}
                  />
                )}
              </li>
            ))}
          </ul>
          {items.length > visibleCount ? (
            <div className="py-3 text-center">
              <Button
                variant="tertiary"
                size="small"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                {t("common:git.rail.loadMoreSources", {
                  count: items.length - visibleCount,
                })}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
