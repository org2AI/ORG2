/**
 * Post/edit/delete callbacks for `useCloudChannelMessages`. Each one lands
 * its result on the loaded transcript only while the hook still shows the
 * channel it was issued for (`listKeyRef` scope guard).
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";

import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthAtom";

import {
  deleteCloudChannelMessage,
  editCloudChannelMessage,
  postCloudChannelMessage,
} from "./channelMessagesClient";
import type { CloudChannelMessage } from "./channelMessagesTypes";
import {
  type CloudChannelMessagesState,
  createOptimisticMessage,
  mergeChannelMessageDelta,
} from "./useCloudChannelMessages.transforms";

export type CloudChannelMessageMutations = Pick<
  CloudChannelMessagesState,
  "postMessage" | "editMessage" | "deleteMessage"
>;

export function useCloudChannelMessageMutations(input: {
  orgId: string | null;
  channelId: string | null;
  listKeyRef: MutableRefObject<string | null>;
  idempotencyRef: MutableRefObject<boolean>;
  authRef: MutableRefObject<Org2CloudAuthState | null>;
  getFreshAccessToken: () => Promise<string>;
  setMessages: Dispatch<SetStateAction<CloudChannelMessage[] | null>>;
}): CloudChannelMessageMutations {
  const {
    orgId,
    channelId,
    listKeyRef,
    idempotencyRef,
    authRef,
    getFreshAccessToken,
    setMessages,
  } = input;

  const postMessage = useCallback(
    async (body: string): Promise<void> => {
      if (!orgId || !channelId) throw new Error("no channel");
      const keyAtStart = listKeyRef.current;
      const clientKey = idempotencyRef.current ? crypto.randomUUID() : null;
      const optimistic = createOptimisticMessage({
        channelId,
        body,
        authorUserId: authRef.current?.userId ?? "",
        authorDisplayName: authRef.current?.profile?.displayName ?? undefined,
        clientKey: clientKey ?? undefined,
      });
      setMessages((current) =>
        current ? [...current, optimistic] : [optimistic]
      );
      try {
        const accessToken = await getFreshAccessToken();
        const message = await postCloudChannelMessage(
          accessToken,
          orgId,
          channelId,
          body,
          clientKey ? { clientKey } : undefined
        );
        if (listKeyRef.current !== keyAtStart) return;
        setMessages((current) =>
          mergeChannelMessageDelta(
            (current ?? []).filter((row) => row.id !== optimistic.id),
            [message]
          )
        );
      } catch (err) {
        if (listKeyRef.current === keyAtStart) {
          setMessages((current) =>
            current
              ? current.filter((row) => row.id !== optimistic.id)
              : current
          );
        }
        // Rethrow: `useSubmitMessage` restores the editor snapshot only on a
        // rejected override, so swallowing this would destroy the draft.
        throw err;
      }
    },
    [
      authRef,
      channelId,
      getFreshAccessToken,
      idempotencyRef,
      listKeyRef,
      orgId,
      setMessages,
    ]
  );

  const editMessage = useCallback(
    async (messageId: string, body: string): Promise<void> => {
      if (!orgId) throw new Error("no org");
      const keyAtStart = listKeyRef.current;
      const accessToken = await getFreshAccessToken();
      const message = await editCloudChannelMessage(
        accessToken,
        orgId,
        messageId,
        body
      );
      if (listKeyRef.current !== keyAtStart) return;
      setMessages((current) =>
        current ? mergeChannelMessageDelta(current, [message]) : current
      );
    },
    [getFreshAccessToken, listKeyRef, orgId, setMessages]
  );

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      if (!orgId) throw new Error("no org");
      const keyAtStart = listKeyRef.current;
      const accessToken = await getFreshAccessToken();
      await deleteCloudChannelMessage(accessToken, orgId, messageId);
      if (listKeyRef.current !== keyAtStart) return;
      // The server answers `{ok}`, so stamp the tombstone locally; the row
      // keeps its slot exactly like the local plane's delete.
      const deletedAt = new Date().toISOString();
      setMessages((current) =>
        current
          ? current.map((row) =>
              row.id === messageId
                ? {
                    ...row,
                    body: "",
                    deletedAt,
                    mentionedUserIds: [],
                    stateChangedAt: deletedAt,
                  }
                : row
            )
          : current
      );
    },
    [getFreshAccessToken, listKeyRef, orgId, setMessages]
  );

  return { postMessage, editMessage, deleteMessage };
}
