/**
 * Source rows of the focused-chat workstation rail: the images and links the
 * user sent in the active session. Follows the Subagents section — a short
 * inline preview, the rest behind a "load more" submenu. A link opens in My
 * Station's Browser; an image opens the chat's image viewer with the
 * session's other images as its gallery.
 */
import type { TFunction } from "i18next";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { Link01Icon, MoreHorizontalIcon } from "@src/icons";
import { openInBrowserApp } from "@src/util/ui/openLink";

import { useWorkstationRailSubmenu } from "./WorkstationRailSubmenu";
import type { WorkstationSourceImage } from "./WorkstationSourceImagePreview";
import type { FocusedChatRailItem, FocusedChatRailSource } from "./types";

/** Source rows shown inline; the rest sit behind the "load more" submenu. */
const SOURCE_PREVIEW_COUNT = 5;

type ImageSource = Extract<FocusedChatRailSource, { kind: "image" }>;

export interface WorkstationSourceImagePreviewState {
  images: WorkstationSourceImage[];
  index: number;
}

export function sourceRowLabel(
  t: TFunction,
  source: FocusedChatRailSource
): string {
  if (source.kind === "link") return source.label;
  return source.fileName ?? t("common:git.rail.sourceImage");
}

export function useWorkstationRailSources({
  setMenuOpen,
  sources,
  t,
}: {
  setMenuOpen: (open: boolean) => void;
  sources: FocusedChatRailSource[];
  t: TFunction;
}) {
  const {
    anchor: sourcesSubmenuAnchor,
    close: closeSourcesSubmenu,
    maxHeight: sourcesSubmenuMaxHeight,
    panelRef: sourcesSubmenuPanelRef,
    toggle: toggleSourcesSubmenu,
    width: sourcesSubmenuWidth,
  } = useWorkstationRailSubmenu();
  const [imagePreview, setImagePreview] =
    useState<WorkstationSourceImagePreviewState | null>(null);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);

  const openSource = useCallback(
    (source: FocusedChatRailSource) => {
      closeSourcesSubmenu();
      setMenuOpen(false);
      if (source.kind === "link") {
        openInBrowserApp(source.url);
        return;
      }
      // Snapshot the gallery: a refetch while the viewer is open must not
      // shift the image under the user.
      const imageSources = sources.filter(
        (candidate): candidate is ImageSource => candidate.kind === "image"
      );
      const index = imageSources.findIndex(
        (candidate) => candidate.key === source.key
      );
      if (index < 0) return;
      setImagePreview({
        images: imageSources.map(({ ref, fileName }) => ({ ref, fileName })),
        index,
      });
    },
    [closeSourcesSubmenu, setMenuOpen, sources]
  );

  const sourceItems = useMemo<FocusedChatRailItem[]>(() => {
    const previewed = sources.slice(0, SOURCE_PREVIEW_COUNT).map((source) => ({
      key: `source:${source.key}`,
      label: sourceRowLabel(t, source),
      icon: Link01Icon,
      imageRef: source.kind === "image" ? source.ref : undefined,
      onClick: () => openSource(source),
    }));
    if (sources.length <= SOURCE_PREVIEW_COUNT) return previewed;
    return [
      ...previewed,
      {
        key: "sources-load-more",
        label: t("common:git.rail.loadMoreSources", {
          count: sources.length - SOURCE_PREVIEW_COUNT,
        }),
        icon: MoreHorizontalIcon,
        submenu: true,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) =>
          toggleSourcesSubmenu(event.currentTarget),
      },
    ];
  }, [openSource, sources, t, toggleSourcesSubmenu]);

  return {
    closeImagePreview,
    closeSourcesSubmenu,
    imagePreview,
    openSource,
    sourceItems,
    sourcesSubmenuAnchor,
    sourcesSubmenuMaxHeight,
    sourcesSubmenuPanelRef,
    sourcesSubmenuWidth,
  };
}
