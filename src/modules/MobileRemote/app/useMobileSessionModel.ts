import { type RefObject, useCallback, useRef, useState } from "react";

import {
  type MobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import type {
  MobileConnectionState,
  MobileModelOption,
  MobileSessionModelConfig,
  MobileSessionModelState,
} from "../connection/types";

const INITIAL_SESSION_MODEL_STATE: MobileSessionModelState = {
  config: null,
  options: [],
  loading: false,
  patching: false,
};

const DEMO_SESSION_MODEL: MobileSessionModelConfig = {
  sessionId: "fix-auth-tests",
  model: "claude-sonnet-4-5",
  accountId: "demo-account",
  modelEditable: true,
};

const DEMO_MODEL_OPTIONS: MobileModelOption[] = [
  {
    id: "claude-sonnet-4-5",
    accountId: "demo-account",
    accountLabel: "Demo Anthropic",
  },
  {
    id: "claude-opus-4-5",
    accountId: "demo-account",
    accountLabel: "Demo Anthropic",
  },
];

export function useMobileSessionModel({
  clientRef,
  connectionRef,
  activeSessionRef,
  requireWritableClient,
}: {
  clientRef: RefObject<MobileRpcClient | null>;
  connectionRef: RefObject<MobileConnectionState>;
  activeSessionRef: RefObject<string | null>;
  requireWritableClient: () => MobileRpcClient;
}) {
  const [sessionModel, setSessionModelState] =
    useState<MobileSessionModelState>(INITIAL_SESSION_MODEL_STATE);
  const sessionModelRequestRef = useRef(0);
  const refreshSessionModel = useCallback(
    async (sessionId: string) => {
      const requestGeneration = ++sessionModelRequestRef.current;
      setSessionModelState((prev) => ({
        ...prev,
        loading: true,
        error: undefined,
      }));
      const currentConnection = connectionRef.current;
      if (currentConnection.demoMode) {
        if (requestGeneration !== sessionModelRequestRef.current) return;
        setSessionModelState({
          config: { ...DEMO_SESSION_MODEL, sessionId },
          options: DEMO_MODEL_OPTIONS,
          loading: false,
          patching: false,
        });
        return;
      }
      const client = clientRef.current;
      if (!client || currentConnection.presence !== "online") {
        setSessionModelState((prev) => ({
          ...prev,
          loading: false,
          error: "Desktop is offline",
        }));
        return;
      }
      try {
        const [config, list] = await Promise.all([
          client.call<MobileSessionModelConfig>("session/config", {
            sessionId,
          }),
          client.call<{ models?: MobileModelOption[] }>("models/list", {
            sessionId,
          }),
        ]);
        if (
          requestGeneration !== sessionModelRequestRef.current ||
          activeSessionRef.current !== sessionId ||
          clientRef.current !== client
        ) {
          return;
        }
        setSessionModelState({
          config,
          options: list.models ?? [],
          loading: false,
          patching: false,
        });
      } catch (error) {
        if (
          requestGeneration !== sessionModelRequestRef.current ||
          activeSessionRef.current !== sessionId ||
          clientRef.current !== client
        )
          return;
        setSessionModelState((prev) => ({
          ...prev,
          loading: false,
          error: toMobileRpcError(error).message,
        }));
      }
    },
    [clientRef, connectionRef, activeSessionRef]
  );

  const setSessionModel = useCallback(
    async (sessionId: string, option: MobileModelOption) => {
      const requestGeneration = ++sessionModelRequestRef.current;
      const client = clientRef.current;
      const isCurrent = () =>
        requestGeneration === sessionModelRequestRef.current &&
        activeSessionRef.current === sessionId &&
        clientRef.current === client;
      setSessionModelState((prev) => ({
        ...prev,
        patching: true,
        loading: false,
        error: undefined,
      }));
      const currentConnection = connectionRef.current;
      if (currentConnection.demoMode) {
        setSessionModelState((prev) => ({
          ...prev,
          patching: false,
          config: prev.config
            ? {
                ...prev.config,
                sessionId,
                model: option.id,
                accountId: option.accountId,
              }
            : {
                sessionId,
                model: option.id,
                accountId: option.accountId,
                modelEditable: true,
              },
        }));
        return;
      }
      try {
        await requireWritableClient().call("session/patch", {
          sessionId,
          patch: {
            model: option.id,
            accountId: option.accountId || undefined,
          },
        });
        if (!isCurrent()) return;
        setSessionModelState((prev) => ({
          ...prev,
          patching: false,
          config: prev.config
            ? {
                ...prev.config,
                model: option.id,
                accountId: option.accountId,
              }
            : {
                sessionId,
                model: option.id,
                accountId: option.accountId,
                modelEditable: true,
              },
        }));
      } catch (error) {
        if (!isCurrent()) throw error;
        setSessionModelState((prev) => ({
          ...prev,
          patching: false,
          error: toMobileRpcError(error).message,
        }));
        throw error;
      }
    },
    [requireWritableClient, connectionRef, clientRef, activeSessionRef]
  );

  const resetSessionModel = useCallback(() => {
    sessionModelRequestRef.current += 1;
    setSessionModelState(INITIAL_SESSION_MODEL_STATE);
  }, []);
  return {
    sessionModel,
    refreshSessionModel,
    setSessionModel,
    resetSessionModel,
  };
}
