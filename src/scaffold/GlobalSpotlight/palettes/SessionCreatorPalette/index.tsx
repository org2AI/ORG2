/**
 * SessionCreatorPalette
 *
 * Embeds SessionCreatorChatPanel directly inside the Spotlight shell,
 * letting the user configure and launch a new session without leaving
 * the palette (no navigation to Agent Station).
 */
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { SessionLaunchSuccessInfo } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { SessionCreatorChatPanel } from "@src/features/SessionCreator/variants";
import { Add01Icon } from "@src/icons";
import type { BasePaletteProps } from "@src/scaffold/GlobalSpotlight/shared";

import { SpotlightFormLayout } from "../../forms/shared/SpotlightFormLayout";
import { SpotlightFormBody } from "../../forms/shared/SpotlightFormShell";
import { SpotlightShell } from "../../shell";
import type { PathSegment } from "../../types";

interface SessionCreatorPaletteProps extends BasePaletteProps {
  asBody?: boolean;
}

export function SessionCreatorPalette({
  isOpen,
  onClose,
  onGoBackToParent,
  asBody = false,
}: SessionCreatorPaletteProps) {
  const { t } = useTranslation("navigation");
  const handleBack = onGoBackToParent ?? onClose;

  const handleSessionStart = useCallback(
    (_info: SessionLaunchSuccessInfo) => {
      onClose();
    },
    [onClose]
  );

  const path = useMemo<PathSegment[]>(
    () => [
      {
        type: "action",
        id: "new-session",
        label: t("labels.newSession"),
        icon: Add01Icon,
        color: "primary",
      },
    ],
    [t]
  );

  const body = (
    <SpotlightFormLayout
      header={{ path, onRemoveSegment: handleBack }}
      className="flex min-h-0 flex-col"
    >
      <SpotlightFormBody>
        <SessionCreatorChatPanel
          spotlight
          headerLayout="compact"
          hidePresenceButton
          onSessionStart={handleSessionStart}
          innerClassName="p-0!"
        />
      </SpotlightFormBody>
    </SpotlightFormLayout>
  );

  if (asBody) return body;

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction
      hideFooter
    >
      {body}
    </SpotlightShell>
  );
}
