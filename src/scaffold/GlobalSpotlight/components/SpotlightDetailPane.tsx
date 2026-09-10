import { openPath } from "@tauri-apps/plugin-opener";
import React from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import HoverCardBase from "@src/components/SessionHoverCard/HoverCardBase";
import { createLogger } from "@src/hooks/logger";
import { FolderClosedIcon, FolderOpenIcon } from "@src/icons";

import { ICONS } from "../config";
import { SPOTLIGHT_CONFIG, SPOTLIGHT_TOKENS } from "../constants";
import type { SpotlightItem } from "../types";

interface Props {
  item: SpotlightItem;
  children: React.ReactElement;
}

const log = createLogger("SpotlightDetailPane");

function DetailLine({
  icon,
  text,
  localPath = false,
}: {
  icon?: React.ComponentProps<typeof AnyIcon>["icon"];
  text: string;
  localPath?: boolean;
}) {
  const canOpen = localPath && /^(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/.test(text);
  return (
    <div className="mt-2 flex items-center gap-2 text-text-2">
      {icon && <AnyIcon icon={icon} size={14} className="shrink-0" />}
      {canOpen ? (
        <button
          type="button"
          className="group/path flex min-w-0 cursor-pointer items-center gap-1.5 text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-primary-6 focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            void openPath(text).catch((error: unknown) => {
              log.error("Failed to open local path:", error);
            });
          }}
        >
          <span className="min-w-0 truncate">{text}</span>
          <AnyIcon
            icon={FolderOpenIcon}
            size={14}
            className="shrink-0 opacity-0 group-hover/path:opacity-100 group-focus-visible/path:opacity-100"
          />
        </button>
      ) : (
        <span className="min-w-0 truncate">{text}</span>
      )}
    </div>
  );
}

/** Shared across palettes. Details use already-loaded row metadata only. */
export function SpotlightDetailPane({ item, children }: Props) {
  const { t } = useTranslation();
  const data = item.data;
  if (data?.isHeader || data?.disabled) return children;
  const isBranch = item.type === "branch" || data?.isRef === true;
  if (isBranch) return children;
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
  const description = !path
    ? [data?.description, data?.descTitle, item.description, item.desc].find(
        (value): value is string => typeof value === "string" && !!value.trim()
      )
    : undefined;
  const summary = [
    isCurrent ? t("selectors.branch.labels.current") : undefined,
    description,
  ]
    .filter(Boolean)
    .join(" · ");
  const folders = data?.detailFolders;
  const worktreePath =
    typeof data?.worktreePath === "string" ? data.worktreePath : undefined;
  const branch = typeof data?.branch === "string" ? data.branch : undefined;
  const folderName = worktreePath?.split("/").filter(Boolean).pop();
  if (!summary && !path && !branch && !folders?.length) return children;

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
          data-spotlight-detail-pane
          className={`w-80 max-w-[calc(100vw-16px)] p-4 text-text-1 select-text ${SPOTLIGHT_TOKENS.subFontSize}`}
        >
          {folders?.length ? (
            <div className="flex flex-col gap-4" data-spotlight-repo-details>
              {folders.map((folder, index) => (
                <div key={index}>
                  <div className="truncate font-medium">{folder.name}</div>
                  <DetailLine
                    icon={FolderClosedIcon}
                    text={folder.path}
                    localPath
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="truncate font-medium">
                {folderName || item.label}
              </div>
              {branch && <DetailLine icon={ICONS.branch} text={branch} />}
              {summary && <DetailLine text={summary} />}
              {path && (
                <DetailLine icon={FolderClosedIcon} text={path} localPath />
              )}
            </>
          )}
        </section>
      )}
    >
      {children}
    </HoverCardBase>
  );
}
