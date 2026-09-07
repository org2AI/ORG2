import React from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import HoverCardBase from "@src/components/SessionHoverCard/HoverCardBase";
import Tag from "@src/components/Tag";

import { ICONS } from "../config";
import { SPOTLIGHT_CONFIG, SPOTLIGHT_TOKENS } from "../constants";
import type { SpotlightItem } from "../types";

interface Props {
  item: SpotlightItem;
  children: React.ReactElement;
}

/** Shared across palettes. Details use already-loaded row metadata only. */
export function SpotlightDetailPane({ item, children }: Props) {
  const { t } = useTranslation();
  const data = item.data;
  if (data?.isHeader || data?.disabled) return children;
  const isBranch = item.type === "branch" || data?.isRef === true;
  const isCurrent =
    data?.isCurrentSelection === true || data?.isCurrent === true;
  const path = [
    data?.contextMenuCopy?.path,
    data?.fs_uri,
    data?.repoPath,
    data?.worktreePath,
    data?.repo_url,
    item.type === "file" ? data?.rightLabel : undefined,
  ].find(
    (value): value is string => typeof value === "string" && !!value.trim()
  );
  // Branch descriptions and right labels contain commit times, so the pane
  // derives its summary from explicit branch metadata instead.
  const description =
    !isBranch && !path
      ? [data?.description, data?.descTitle, item.description, item.desc].find(
          (value): value is string =>
            typeof value === "string" && !!value.trim()
        )
      : undefined;
  const summary = [
    isBranch
      ? data?.isRemote
        ? t("git.remote")
        : t("filters.local")
      : undefined,
    isCurrent ? t("selectors.branch.labels.current") : undefined,
    path,
    typeof data?.branch === "string" ? data.branch : undefined,
    description,
  ]
    .filter(Boolean)
    .join(" · ");
  const folders = data?.detailFolders;
  if (!summary && !folders?.length) return children;

  return (
    <HoverCardBase
      key={item.id}
      cardId={`spotlight-detail:${item.id}`}
      position="right-or-bottom"
      anchorSelector="[data-spotlight-detail-anchor], [role='menu']"
      panelClassName="rounded-2xl border border-border-2 bg-bg-2 shadow-xl"
      zIndex={SPOTLIGHT_CONFIG.containerZIndex + 1}
      renderContent={() => (
        <section
          aria-label={item.label}
          data-spotlight-detail-pane
          className={`w-80 max-w-[calc(100vw-16px)] p-4 text-text-1 select-text ${SPOTLIGHT_TOKENS.subFontSize}`}
        >
          <div className="flex items-start gap-2 font-medium">
            {item.icon && (
              <AnyIcon
                icon={item.icon}
                size={SPOTLIGHT_TOKENS.iconSize}
                className="shrink-0 text-text-2"
              />
            )}
            <span className="min-w-0 truncate">{item.label}</span>
          </div>
          {folders?.length ? (
            <div
              className="mt-2 flex gap-1.5 overflow-x-auto pb-1"
              data-spotlight-folder-chips
            >
              {folders.map((folder, index) => (
                <span key={index} className="shrink-0" title={folder.path}>
                  <Tag
                    size="small"
                    icon={<AnyIcon icon={ICONS.folder} size={12} />}
                  >
                    <span className="block max-w-48 truncate">
                      {folder.name}
                    </span>
                  </Tag>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 truncate text-text-2" title={summary}>
              {summary}
            </div>
          )}
        </section>
      )}
    >
      {children}
    </HoverCardBase>
  );
}
