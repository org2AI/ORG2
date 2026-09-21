import type { MobileRemoteRuntimePort } from "../platform/types";
import { invalidateMobileSessionIdentities } from "./mobileSessionIdentityCache";
import type {
  JsonRpcInbound,
  JsonRpcNotification,
  JsonRpcRequest,
  MobileRpcError,
} from "./types";
import {
  MobileConnectionAuthorizationError,
  MobileConnectionTicketError,
  isJsonRpcResponse,
} from "./types";

export type RpcNotificationHandler = (
  method: string,
  params: Record<string, unknown> | undefined
) => void;

export interface MobileRpcClient {
  call<T>(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onNotification(handler: RpcNotificationHandler): () => void;
  close(): void;
  get readyState(): number;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: number;
  cleanup: () => void;
}

const CLOSED = 3;
const MAX_PENDING_CALLS = 128;
const RPC_TIMEOUT_MS = 15_000;

export function createMobileRpcClient(
  socket: WebSocket,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): MobileRpcClient {
  let nextId = 1;
  const pending = new Map<number, PendingCall>();
  const notificationHandlers = new Set<RpcNotificationHandler>();

  const flushPending = (error: Error) => {
    for (const entry of pending.values()) {
      runtime.clearTimeout(entry.timeoutId);
      entry.cleanup();
      entry.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let parsed: JsonRpcInbound;
    try {
      parsed = JSON.parse(String(event.data)) as JsonRpcInbound;
    } catch {
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const waiter = pending.get(parsed.id);
      if (!waiter) return;
      pending.delete(parsed.id);
      runtime.clearTimeout(waiter.timeoutId);
      waiter.cleanup();
      if (parsed.error) {
        waiter.reject(
          Object.assign(
            new Error(parsed.error.message || `RPC error ${parsed.error.code}`),
            { code: parsed.error.code }
          )
        );
        return;
      }
      waiter.resolve(parsed.result);
      return;
    }

    const notification = parsed as JsonRpcNotification;
    if (
      notification.method === "session/list_changed" ||
      (notification.method === "relay/presence" &&
        notification.params?.online === false)
    )
      invalidateMobileSessionIdentities(client);
    for (const handler of notificationHandlers) {
      handler(notification.method, notification.params);
    }
  });

  socket.addEventListener("close", () => {
    invalidateMobileSessionIdentities(client);
    flushPending(new Error("WebSocket closed"));
  });

  const client: MobileRpcClient = {
    get readyState() {
      return socket.readyState;
    },
    call<T>(
      method: string,
      params: Record<string, unknown> = {},
      signal?: AbortSignal
    ): Promise<T> {
      const abortError = () =>
        new DOMException("RPC call aborted", "AbortError");
      if (signal?.aborted) return Promise.reject(abortError());
      if (socket.readyState !== 1) {
        return Promise.reject(new Error("WebSocket is not open"));
      }
      if (pending.size >= MAX_PENDING_CALLS) {
        return Promise.reject(new Error("Too many pending RPC calls"));
      }
      const id = nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      return new Promise<T>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const onAbort = () => {
          const entry = pending.get(id);
          if (!entry) return;
          cleanup();
          // Local cancellation cannot stop work already sent to Desktop.
          // Retain a bounded tombstone until reply/timeout, so repeated aborts
          // cannot bypass the outstanding-wire-request limit.
          pending.set(id, {
            timeoutId: entry.timeoutId,
            resolve: () => {},
            reject: () => {},
            cleanup: () => {},
          });
          reject(abortError());
        };
        const timeoutId = runtime.setTimeout(() => {
          const entry = pending.get(id);
          pending.delete(id);
          entry?.cleanup();
          entry?.reject(new Error(`RPC call timed out: ${method}`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          timeoutId,
          cleanup,
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          socket.send(JSON.stringify(request));
        } catch (error) {
          pending.delete(id);
          runtime.clearTimeout(timeoutId);
          cleanup();
          reject(error);
        }
      });
    },
    notify(method: string, params: Record<string, unknown> = {}) {
      if (socket.readyState !== 1) return;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    },
    onNotification(handler: RpcNotificationHandler) {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    },
    close() {
      invalidateMobileSessionIdentities(client);
      if (socket.readyState !== CLOSED) {
        socket.close();
      }
      flushPending(new Error("RPC client closed"));
    },
  };
  return client;
}

export function toMobileRpcError(error: unknown): MobileRpcError {
  if (error instanceof MobileConnectionTicketError) {
    return { code: -1, message: error.message, connectionIssue: "ticket" };
  }
  if (error instanceof MobileConnectionAuthorizationError) {
    return {
      code: -1,
      message: error.message,
      connectionIssue: "authorization",
    };
  }
  if (error instanceof Error) {
    return { code: -1, message: error.message };
  }
  return { code: -1, message: String(error) };
}
