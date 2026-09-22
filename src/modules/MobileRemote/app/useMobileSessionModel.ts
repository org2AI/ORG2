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
  const sessionModelRef = useRef(sessionModel);
  sessionModelRef.current = sessionModel;
  const sessionModelRequestRef = useRef(0);
  const optionsGenerationRef = useRef(0);
  const optionsFlightRef = useRef<{
    client: MobileRpcClient | null;
    sessionId: string;
    promise: Promise<void>;
  } | null>(null);
  const optionsReadyRef = useRef<{
    client: MobileRpcClient | null;
    sessionId: string;
  } | null>(null);
  const refreshSessionModel = useCallback(
    async (sessionId: string) => {
      const requestGeneration = ++sessionModelRequestRef.current;
      optionsReadyRef.current = null;
      if (sessionModelRef.current.config?.sessionId !== sessionId) {
        optionsGenerationRef.current += 1;
        optionsFlightRef.current = null;
      }
      setSessionModelState((prev) => ({
        ...(prev.config?.sessionId === sessionId
          ? prev
          : INITIAL_SESSION_MODEL_STATE),
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
        const config = await client.call<MobileSessionModelConfig>(
          "session/config",
          { sessionId }
        );
        if (
          requestGeneration !== sessionModelRequestRef.current ||
          activeSessionRef.current !== sessionId ||
          clientRef.current !== client
        ) {
          return;
        }
        setSessionModelState((prev) => ({
          ...prev,
          config,
          loading: false,
          patching: false,
          options: prev.config?.sessionId === sessionId ? prev.options : [],
        }));
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

  const loadSessionModels = useCallback(
    (sessionId: string): Promise<void> => {
      const client = clientRef.current;
      if (
        optionsFlightRef.current?.client === client &&
        optionsFlightRef.current.sessionId === sessionId
      )
        return optionsFlightRef.current.promise;
      if (
        optionsReadyRef.current?.client === client &&
        optionsReadyRef.current.sessionId === sessionId
      )
        return Promise.resolve();
      if (activeSessionRef.current !== sessionId) return Promise.resolve();
      const config = sessionModelRef.current.config;
      if (config?.sessionId !== sessionId || config.modelEditable !== true)
        return Promise.resolve();
      if (connectionRef.current.demoMode) {
        setSessionModelState((prev) => ({
          ...prev,
          options: DEMO_MODEL_OPTIONS,
        }));
        return Promise.resolve();
      }
      if (!client || connectionRef.current.presence !== "online")
        return Promise.resolve();
      const generation = ++optionsGenerationRef.current;
      const current = () =>
        generation === optionsGenerationRef.current &&
        clientRef.current === client &&
        activeSessionRef.current === sessionId;
      setSessionModelState((prev) => ({
        ...prev,
        optionsLoading: true,
        optionsError: undefined,
      }));
      const promise = Promise.resolve().then(async () => {
        try {
          const list = await client.call<{ models: MobileModelOption[] }>(
            "models/list",
            { sessionId }
          );
          if (
            !Array.isArray(list?.models) ||
            list.models.length > 256 ||
            list.models.some(
              (option) =>
                !option ||
                typeof option.id !== "string" ||
                typeof option.accountId !== "string" ||
                typeof option.accountLabel !== "string"
            )
          )
            throw new Error("Invalid model catalog");
          if (!current()) return;
          optionsReadyRef.current = { client, sessionId };
          setSessionModelState((prev) => ({
            ...prev,
            options: list.models,
            optionsLoading: false,
          }));
        } catch (error) {
          if (current())
            setSessionModelState((prev) => ({
              ...prev,
              optionsLoading: false,
              optionsError: toMobileRpcError(error).message,
            }));
        } finally {
          if (optionsFlightRef.current?.promise === promise)
            optionsFlightRef.current = null;
        }
      });
      optionsFlightRef.current = { client, sessionId, promise };
      return promise;
    },
    [activeSessionRef, clientRef, connectionRef]
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
    optionsGenerationRef.current += 1;
    optionsFlightRef.current = null;
    optionsReadyRef.current = null;
    setSessionModelState(INITIAL_SESSION_MODEL_STATE);
  }, []);
  return {
    sessionModel,
    refreshSessionModel,
    loadSessionModels,
    setSessionModel,
    resetSessionModel,
  };
}
