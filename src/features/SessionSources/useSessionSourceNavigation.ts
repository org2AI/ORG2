/** Source navigation is shared by the rail summary and the complete Sources tab. */
import { useCallback, useState } from "react";

import Message from "@src/components/Message";
import { ROUTES } from "@src/config/routes";
import type { SessionSource } from "@src/engines/ChatPanel/sessionSources/extractSessionSources";
import { useOpenSessionSharedFile } from "@src/features/Org2Cloud/SharedSessionFilesContext";
import { sharedFileAbsolutePath } from "@src/features/Org2Cloud/sessionSharedFileCandidates";
import i18n from "@src/i18n";
import {
  createDirectoryTab,
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
} from "@src/store/workstation/tabs";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { openFileInWorkStation } from "@src/util/ui/openFileInWorkStation";
import { openInBrowserApp } from "@src/util/ui/openLink";
import { revealMyStation } from "@src/util/ui/revealMyStation";

import type { SessionSourceImage } from "./SessionSourceImagePreview";

export interface SessionSourceImagePreviewState {
  images: SessionSourceImage[];
  index: number;
}

export function useSessionSourceNavigation(
  sources: SessionSource[],
  basePath?: string
) {
  const openSharedFile = useOpenSessionSharedFile();
  const [imagePreview, setImagePreview] =
    useState<SessionSourceImagePreviewState | null>(null);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);
  const openSource = useCallback(
    (source: SessionSource) => {
      if (source.kind === "tool-group") return;
      if (source.kind === "link") {
        openInBrowserApp(source.url);
        return;
      }
      if (source.kind === "file") {
        if (openSharedFile(source.path)) return;
        const path = sharedFileAbsolutePath(
          source.path.replace(/^folder:\/\//u, ""),
          basePath
        );
        if (!path) {
          Message.error(i18n.t("common:git.rail.sourceFileUnavailable"));
          return;
        }
        if (source.isDirectory) {
          const store = getInstrumentedStore();
          revealMyStation({ path: ROUTES.workStation.code.path });
          store.set(openWorkstationTabAtom, {
            workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
            tab: createDirectoryTab(path),
          });
        } else {
          openFileInWorkStation(path, { defaultPreviewMode: true });
        }
        return;
      }
      // Snapshot this gallery so a refresh never changes the selected image.
      const images = sources.filter((candidate) => candidate.kind === "image");
      const index = images.findIndex(
        (candidate) => candidate.key === source.key
      );
      if (index >= 0) {
        setImagePreview({
          images: images.map(({ ref, fileName }) => ({ ref, fileName })),
          index,
        });
      }
    },
    [sources, basePath, openSharedFile]
  );
  return { openSource, imagePreview, closeImagePreview };
}
