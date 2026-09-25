import React from "react";

import { SharedSessionFilesProvider } from "@src/features/Org2Cloud/SharedSessionFilesContext";
import type { Session } from "@src/store/session";

/** Sources also live outside the transcript's shared-file provider. */
export function SessionSourcesFileScope({
  session,
  children,
}: React.PropsWithChildren<{ session: Session | null | undefined }>) {
  return (
    <SharedSessionFilesProvider
      scope={
        session?.importedFrom
          ? {
              orgId: session.importedFrom.orgId,
              sessionId: session.importedFrom.sourceSessionId,
              endpoint:
                session.importedFrom.sourceEndpointUrl ??
                session.importedFrom.shareEndpointUrl ??
                "",
              repoPath: session.repoPath,
            }
          : null
      }
    >
      {children}
    </SharedSessionFilesProvider>
  );
}
