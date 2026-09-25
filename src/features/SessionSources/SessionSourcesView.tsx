import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import { ListPanelScrollArea } from "@src/components/layout/blocks";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/config/workstation/tokens";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";

import { SessionSourceImagePreview } from "./SessionSourceImagePreview";
import { SessionSourceRow } from "./SessionSourceRow";
import { SessionToolActivityGroup } from "./SessionToolActivityGroup";
import { useSessionSourceNavigation } from "./useSessionSourceNavigation";

const PAGE_SIZE = 30;
const CATEGORIES = [
  { kind: "image", label: "sourceCategoryImages" },
  { kind: "file", label: "sourceCategoryFiles" },
  { kind: "link", label: "sourceCategoryLinks" },
  { kind: "tool-group", label: "sourceCategoryTools" },
] as const;

/** Parent keys this view by session ID: pagination and gallery never cross sessions. */
export function SessionSourcesView({
  sources,
  basePath,
  loading = false,
  error = false,
  onRetry,
}: {
  sources: SessionSource[];
  basePath?: string;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [visibleCounts, setVisibleCounts] = useState<
    Partial<Record<SessionSource["kind"], number>>
  >({});
  const categories = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        ...category,
        items: sources.filter((source) => source.kind === category.kind),
      })).filter((category) => category.items.length > 0),
    [sources]
  );
  const { openSource, imagePreview, closeImagePreview } =
    useSessionSourceNavigation(sources, basePath);

  return (
    <section
      className={`flex h-full min-h-0 flex-col text-text-1 ${EDITOR_TAB_CANVAS_BG_CLASS}`}
      aria-label={t("common:git.rail.sources")}
      data-testid="workstation-sources-view"
      aria-busy={loading}
    >
      <ListPanelScrollArea listPaddingTop="none">
        {error ? (
          <PageNotice
            type="danger"
            compact
            copyable={false}
            role="alert"
            className="my-2"
            action={{
              label: t("common:actions.retry"),
              onClick: onRetry,
              disabled: loading,
            }}
          >
            {t("common:git.rail.sourcesLoadFailed")}
          </PageNotice>
        ) : null}
        {sources.length === 0 ? (
          <p role="status" className="py-8 text-center text-sm text-text-3">
            {loading
              ? t("common:status.loading")
              : error
                ? t("common:git.rail.sourcesUnavailable")
                : t("common:git.rail.noSources")}
          </p>
        ) : (
          <div className="flex flex-col gap-4 py-3">
            {categories.map(({ kind, label, items }) => {
              const visibleCount = visibleCounts[kind] ?? PAGE_SIZE;
              return (
                <section
                  key={kind}
                  aria-label={t(`common:git.rail.${label}`)}
                  data-source-category={kind}
                >
                  <SidebarSectionHeader
                    surface="panel"
                    title={t(`common:git.rail.${label}`)}
                    titleSuffix={
                      <span className="text-xs text-text-3">
                        {items.length}
                      </span>
                    }
                  />
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {items.slice(0, visibleCount).map((source) => (
                      <li key={source.key}>
                        {source.kind === "tool-group" ? (
                          <SessionToolActivityGroup
                            source={source}
                            onOpenSource={openSource}
                          />
                        ) : (
                          <SessionSourceRow
                            source={source}
                            onOpenSource={openSource}
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
                        onClick={() =>
                          setVisibleCounts((counts) => ({
                            ...counts,
                            [kind]: visibleCount + PAGE_SIZE,
                          }))
                        }
                      >
                        {t("common:git.rail.loadMoreSources", {
                          count: items.length - visibleCount,
                        })}
                      </Button>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </ListPanelScrollArea>
      {imagePreview ? (
        <SessionSourceImagePreview
          images={imagePreview.images}
          index={imagePreview.index}
          onClose={closeImagePreview}
        />
      ) : null}
    </section>
  );
}
