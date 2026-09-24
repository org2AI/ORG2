import { atom, useAtomValue } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import SharedSessionFileViewer from "@src/features/Org2Cloud/SharedSessionFileViewer";
import type { SharedFileTabData } from "@src/features/Org2Cloud/openSharedSessionFile";
import { SharedSessionFileAccessContext } from "@src/features/Org2Cloud/sharedSessionFileAccess";

import type { UnifiedTabContentProps } from "../types";

const noPendingReference = atom(null);

export default function SharedFileRenderer({
  tab,
  isActive,
}: UnifiedTabContentProps) {
  const data = tab.data as unknown as SharedFileTabData;
  const resolved = useAtomValue(
    data.pending?.referenceAtom ?? noPendingReference
  );
  const { t } = useTranslation("sessions");
  // No hidden byte cache or background requests: the active preview owns both.
  if (!isActive) return null;
  if (data.pending && !resolved) {
    return (
      <section
        data-testid="shared-file-preview"
        className="h-full overflow-auto bg-bg-1 p-3 text-sm text-text-2"
      >
        <p role={resolved === undefined ? "alert" : "status"}>
          {t(
            resolved === undefined
              ? "sharedFile.error"
              : "sharedFile.resolvingOrigin"
          )}
        </p>
      </section>
    );
  }
  return (
    <SharedSessionFileAccessContext.Provider value={data.getAccess()}>
      <SharedSessionFileViewer
        reference={resolved ?? data.reference}
        openingIdentity={data.identity}
      />
    </SharedSessionFileAccessContext.Provider>
  );
}
