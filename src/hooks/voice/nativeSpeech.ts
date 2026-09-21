import {
  type PluginListener,
  addPluginListener,
  invoke,
} from "@tauri-apps/api/core";

import { isIOS } from "@src/util/platform/isIOS";

export type NativeSpeechEventKind =
  | "started"
  | "partial"
  | "final"
  | "ended"
  | "cancelled"
  | "error";

export interface NativeSpeechEvent {
  sessionId: string;
  kind: NativeSpeechEventKind;
  transcript?: string;
  code?: string;
  message?: string;
}

interface NativeSpeechSupport {
  supported: boolean;
}

export function isNativeIosSpeechRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    (process.env.ORGII_MOBILE_REMOTE_NATIVE === "true" || isIOS()) &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function queryNativeSpeechSupport(): Promise<boolean> {
  const response = await invoke<NativeSpeechSupport>(
    "plugin:speech|is_supported"
  );
  return response.supported;
}

export function listenToNativeSpeech(
  callback: (event: NativeSpeechEvent) => void
): Promise<PluginListener> {
  return addPluginListener("speech", "speech", callback);
}

export function startNativeSpeech(lang: string, sessionId: string) {
  return invoke<void>("plugin:speech|start", { lang, sessionId });
}

export function stopNativeSpeech(sessionId: string) {
  return invoke<void>("plugin:speech|stop", { sessionId });
}

export function cancelNativeSpeech(sessionId: string) {
  return invoke<void>("plugin:speech|cancel", { sessionId });
}
