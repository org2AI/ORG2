/** A compact preview of the session's sources with a full-list tab entry. */
import type { TFunction } from "i18next";
import { createElement, useCallback, useMemo } from "react";

import { SessionSourceIcon } from "@src/features/SessionSources/SessionSourceIcon";
import { sourceLabel } from "@src/features/SessionSources/presentation";
import { useSessionSourceNavigation } from "@src/features/SessionSources/useSessionSourceNavigation";
import { Link01Icon } from "@src/icons";

import type { FocusedChatRailItem, FocusedChatRailSource } from "./types";

const SOURCE_PREVIEW_COUNT = 3;

export function useWorkstationRailSources({
  setMenuOpen,
  sources,
  t,
  onOpenSources,
  basePath,
}: {
  setMenuOpen: (open: boolean) => void;
  sources: FocusedChatRailSource[];
  t: TFunction;
  onOpenSources?: () => void;
  basePath?: string;
}) {
  const {
    openSource: navigateSource,
    imagePreview,
    closeImagePreview,
  } = useSessionSourceNavigation(sources, basePath);
  const openSource = useCallback(
    (source: FocusedChatRailSource) => {
      setMenuOpen(false);
      navigateSource(source);
    },
    [navigateSource, setMenuOpen]
  );
  const sourceItems = useMemo<FocusedChatRailItem[]>(() => {
    // Resource previews must not be displaced by frequently updated tool groups.
    // Keep source order within each category; activity fills unused preview slots.
    const previewCandidates = [
      ...sources.filter((source) => source.kind !== "tool-group"),
      ...sources.filter((source) => source.kind === "tool-group"),
    ];
    const previewed: FocusedChatRailItem[] = previewCandidates
      .slice(0, SOURCE_PREVIEW_COUNT)
      .map((source) => ({
        key: `source:${source.key}`,
        label: sourceLabel(t, source),
        icon: ({ size }: { size?: number }) =>
          createElement(SessionSourceIcon, { source, size }),
        imageRef: source.kind === "image" ? source.ref : undefined,
        onClick: () => {
          if (source.kind === "tool-group") {
            setMenuOpen(false);
            onOpenSources?.();
          } else openSource(source);
        },
      }));
    if (onOpenSources)
      previewed.push({
        key: "sources-view-all",
        visibleWhenCollapsed: true,
        label: t("common:git.rail.viewAllSources"),
        icon: Link01Icon,
        onClick: () => {
          setMenuOpen(false);
          onOpenSources();
        },
      });
    return previewed;
  }, [onOpenSources, openSource, setMenuOpen, sources, t]);
  return { imagePreview, closeImagePreview, openSource, sourceItems };
}
