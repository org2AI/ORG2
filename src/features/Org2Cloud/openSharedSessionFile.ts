import type { Atom } from "jotai";

import { ROUTES } from "@src/config/routes";
import {
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
} from "@src/store/workstation/tabs";
import { defineTabFactory } from "@src/store/workstation/tabs/tabFactory";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { revealMyStation } from "@src/util/ui/revealMyStation";

import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import type { SharedSessionFileAccess } from "./sharedSessionFileAccess";
import type { SharedSessionFileReference } from "./sharedSessionFileReference";

export interface SharedFileTabData {
  reference: SharedSessionFileReference;
  identity: string;
  pending?: {
    key: string;
    referenceAtom: Atom<SharedSessionFileReference | null | undefined>;
  };
  // Runtime capability closure: never put bearer tokens in serializable tab data.
  // The whole tab is also excluded from every persistence partition.
  getAccess: () => SharedSessionFileAccess | null;
}

export const sharedFileTabFactory = defineTabFactory<SharedFileTabData>({
  tabType: "shared-file",
  idStrategy: {
    type: "keyed",
    prefix: "shared-file",
    getKey: ({ identity, reference, pending }) =>
      pending
        ? JSON.stringify([identity, reference.endpoint, pending.key])
        : JSON.stringify([
            identity,
            reference.endpoint,
            reference.id,
            reference.source?.orgId,
            reference.source?.sessionId,
            reference.source?.path,
            reference.source?.version?.uploaderUserId,
            reference.source?.version?.revision,
          ]),
  },
  getTitle: ({ reference }) =>
    reference.source?.path.split(/[\\/]/).pop() || reference.id,
});

/** Open a cloud snapshot in the right pane without navigating away from chat. */
export function openSharedSessionFile(
  reference: SharedSessionFileReference,
  access: SharedSessionFileAccess | null = null,
  pending?: SharedFileTabData["pending"]
): void {
  const store = getInstrumentedStore();
  const auth = store.get(org2CloudAuthAtom);
  const identity = auth ? org2CloudAuthIdentityKey(auth) : "";
  const capability = access?.endpoint === reference.endpoint ? access : null;
  const tab = sharedFileTabFactory({
    reference,
    identity,
    pending,
    getAccess: () => capability,
  });
  revealMyStation({ path: ROUTES.workStation.code.path });
  store.set(openWorkstationTabAtom, {
    workspace: store.get(presentedWorkstationWorkspaceKeyAtom),
    tab,
  });
}
