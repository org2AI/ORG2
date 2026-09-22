import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileRemoteRuntimePort } from "../platform/types";

const CONNECT_TIMEOUT_MS = 15_000;
const PAIRING_TIMEOUT_MS = 130_000;

export function waitForSocketOpen(
  socket: WebSocket,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before connecting"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

export function waitForPairingApproval(
  socket: WebSocket,
  client: MobileRpcClient,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      unsubscribe();
      socket.removeEventListener("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection closed before pairing was approved"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("Pairing confirmation expired"));
    }, PAIRING_TIMEOUT_MS);
    unsubscribe = client.onNotification((method) => {
      if (method === "pairing/approved") {
        cleanup();
        resolve();
      }
    });
    socket.addEventListener("close", onClose, { once: true });
  });
}
