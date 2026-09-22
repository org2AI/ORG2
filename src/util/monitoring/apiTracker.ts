import {
  getApiCallHotspots,
  getApiCalls,
  getApiCallsForComponent,
  getRecentApiCalls,
} from "./apiTrackerCalls";
import {
  installFetchTracking,
  installXmlHttpRequestTracking,
} from "./apiTrackerHttp";
import {
  cleanupInteractionTracking,
  installInteractionTracking,
} from "./apiTrackerInteractions";
import {
  clearPushEvents,
  getPushHotspots,
  recordPushEvent,
} from "./apiTrackerPush";
import {
  clearApiCallRecords,
  clearRequestTimings,
  disableTrackingState,
  enableTrackingState,
  isTracingEnabled,
  isTrackingEnabled,
  resetTrackingObservation,
  toggleTracingState,
} from "./apiTrackerState";
import {
  installDirectTauriInvokeTracking,
  installTauriCallbackTracking,
  trackTauriInvoke,
  trackTauriInvokeResult,
  withDirectTauriInvokeTrackingSuppressed,
} from "./apiTrackerTauri";
import {
  clearTimerEvents,
  getTimerEvents,
  getTimerHotspots,
  installTimerTracking,
} from "./apiTrackerTimers";

export type {
  ApiCall,
  ApiCallHotspot,
  ApiTransport,
  InteractionType,
  PushHotspot,
  PushKind,
  TimerFireEvent,
  TimerHotspot,
  TimerKind,
} from "./apiTrackerTypes";

export {
  cleanupInteractionTracking,
  getApiCallHotspots,
  getApiCalls,
  getApiCallsForComponent,
  getPushHotspots,
  getRecentApiCalls,
  getTimerEvents,
  getTimerHotspots,
  recordPushEvent,
  trackTauriInvoke,
  trackTauriInvokeResult,
  withDirectTauriInvokeTrackingSuppressed,
};

let cleanupDirectTauriInvokeTracking: (() => void) | undefined;
let cleanupTauriCallbackTracking: (() => void) | undefined;
let cleanupTimerTracking: (() => void) | undefined;
let cleanupFetchTracking: (() => void) | undefined;
let cleanupXmlHttpRequestTracking: (() => void) | undefined;

export const enableApiTracking = (): void => {
  enableTrackingState();
  cleanupDirectTauriInvokeTracking = installDirectTauriInvokeTracking();
  cleanupTauriCallbackTracking = installTauriCallbackTracking();
  // Production bundles intentionally omit source maps. Timer/RAF stack
  // capture cannot attribute those callbacks to a source file, so installing
  // the global wrappers there adds measurable CPU while producing no usable
  // hotspot rows. Development builds retain the full timer diagnostics.
  cleanupTimerTracking =
    process.env.NODE_ENV === "production" ? undefined : installTimerTracking();
  cleanupFetchTracking = installFetchTracking();
  cleanupXmlHttpRequestTracking = installXmlHttpRequestTracking();
  installInteractionTracking();
};

export const disableApiTracking = (): void => {
  disableTrackingState();
  cleanupDirectTauriInvokeTracking?.();
  cleanupDirectTauriInvokeTracking = undefined;
  cleanupTauriCallbackTracking?.();
  cleanupTauriCallbackTracking = undefined;
  cleanupTimerTracking?.();
  cleanupTimerTracking = undefined;
  cleanupFetchTracking?.();
  cleanupFetchTracking = undefined;
  cleanupXmlHttpRequestTracking?.();
  cleanupXmlHttpRequestTracking = undefined;
  cleanupInteractionTracking();

  // Result-side handlers return early while disabled, so discard in-flight
  // timing state. Completed calls intentionally remain available.
  clearRequestTimings();
};

export const isApiTrackingEnabled = (): boolean => isTrackingEnabled();

export const clearApiCalls = (): void => {
  resetTrackingObservation();
  clearApiCallRecords();
  clearTimerEvents();
  clearPushEvents();
  clearRequestTimings();

  window.dispatchEvent(
    new CustomEvent("api-call-updated", {
      detail: { apiCall: null, totalCalls: 0 },
    })
  );
};

export const isTracingModeEnabled = (): boolean => isTracingEnabled();

export const toggleTracingMode = (): boolean => {
  const enabled = toggleTracingState();

  window.dispatchEvent(
    new CustomEvent("api-tracing-mode-changed", {
      detail: { enabled },
    })
  );
  return enabled;
};

export const enableTracingMode = (): void => {
  if (!isTracingEnabled()) toggleTracingMode();
};

export const disableTracingMode = (): void => {
  if (isTracingEnabled()) toggleTracingMode();
};
