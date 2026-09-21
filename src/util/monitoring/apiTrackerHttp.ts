import { detectInteractionType } from "./apiTrackerInteractions";
import { summarizeTrackedValue } from "./apiTrackerPayload";
import {
  addApiCall,
  dispatchApiCallUpdatedIfTracing,
  finishRequestTiming,
  isTrackingEnabled,
  startRequestTiming,
} from "./apiTrackerState";
import type { ApiCall } from "./apiTrackerTypes";
import {
  extractFileInfo,
  generateRequestId,
  getApiStack,
  getComponentInfo,
} from "./apiTrackerUtils";

function getHttpStack(): string {
  return getApiStack()
    .split("\n")
    .filter((line) => !line.includes("apiTrackerHttp.ts"))
    .join("\n");
}

let fetchTrackingPatched = false;

function describeFetchTarget(input: RequestInfo | URL): {
  url: string;
  method?: string;
} {
  if (typeof input === "string") return { url: input };
  if (input instanceof URL) return { url: input.href };
  return { url: input.url, method: input.method };
}

function isFetchNoise(url: string): boolean {
  return url.includes("hot-update") || url.includes("__webpack");
}

export function installFetchTracking(): (() => void) | undefined {
  if (fetchTrackingPatched || typeof window === "undefined") return undefined;

  const originalFetch = window.fetch.bind(window);

  const patchedFetch: typeof window.fetch = async (input, init) => {
    const target = describeFetchTarget(input as RequestInfo | URL);
    if (!isTrackingEnabled() || isFetchNoise(target.url)) {
      return originalFetch(input, init);
    }

    const requestId = generateRequestId();
    const stack = getHttpStack();
    const fileInfo = extractFileInfo(stack);
    const componentInfo = getComponentInfo();
    const method = (init?.method || target.method || "GET").toUpperCase();

    const apiCall: ApiCall = {
      id: requestId,
      method,
      url: target.url,
      fullUrl: target.url,
      transport: "http",
      data: summarizeTrackedValue(init?.body),
      timestamp: new Date().toISOString(),
      componentSelector: componentInfo.selector,
      componentLabel: componentInfo.label,
      interactionType: detectInteractionType(),
      filePath: fileInfo.filePath,
      componentName: fileInfo.componentName,
      functionName: fileInfo.functionName,
      lineNumber: fileInfo.lineNumber,
      stack,
    };
    addApiCall(apiCall);
    startRequestTiming(requestId);

    const finish = (status?: number, statusText?: string, error?: unknown) => {
      apiCall.duration = finishRequestTiming(requestId);
      apiCall.status = status;
      apiCall.statusText = statusText;
      if (error !== undefined) {
        apiCall.error = summarizeTrackedValue(error);
      }
      dispatchApiCallUpdatedIfTracing(apiCall);
    };

    try {
      const response = await originalFetch(input, init);
      finish(response.status, response.statusText);
      return response;
    } catch (error) {
      finish(undefined, "Network Error", error);
      throw error;
    }
  };

  try {
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: patchedFetch,
      writable: true,
    });
  } catch {
    return undefined;
  }
  fetchTrackingPatched = true;

  return () => {
    try {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: originalFetch,
        writable: true,
      });
    } finally {
      fetchTrackingPatched = false;
    }
  };
}

interface TrackedXmlHttpRequest {
  method: string;
  url: string;
}

let xmlHttpRequestTrackingPatched = false;

/** Track direct XMLHttpRequest traffic (currently used by file uploads).
 * Installed only while the API panel is open. */
export function installXmlHttpRequestTracking(): (() => void) | undefined {
  if (
    xmlHttpRequestTrackingPatched ||
    typeof window === "undefined" ||
    typeof window.XMLHttpRequest === "undefined"
  ) {
    return undefined;
  }

  const prototype = window.XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const requests = new WeakMap<XMLHttpRequest, TrackedXmlHttpRequest>();
  const callOriginalOpen = originalOpen as (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) => void;

  prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    requests.set(this, { method: method.toUpperCase(), url: String(url) });
    callOriginalOpen.call(this, method, url, async, username, password);
  } as XMLHttpRequest["open"];

  prototype.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    const request = requests.get(this);
    if (!isTrackingEnabled() || !request) {
      originalSend.call(this, body);
      return;
    }

    const stack = getHttpStack();
    const requestId = `xhr-${generateRequestId()}`;
    const fileInfo = extractFileInfo(stack);
    const componentInfo = getComponentInfo();
    const apiCall: ApiCall = {
      id: requestId,
      method: request.method,
      url: request.url,
      fullUrl: request.url,
      transport: "http",
      data: summarizeTrackedValue(body),
      timestamp: new Date().toISOString(),
      componentSelector: componentInfo.selector,
      componentLabel: componentInfo.label,
      interactionType: detectInteractionType(),
      filePath: fileInfo.filePath,
      componentName: fileInfo.componentName,
      functionName: fileInfo.functionName,
      lineNumber: fileInfo.lineNumber,
      stack,
    };

    addApiCall(apiCall);
    startRequestTiming(requestId);
    dispatchApiCallUpdatedIfTracing(apiCall);

    const finish = (): void => {
      if (apiCall.duration !== undefined) return;
      apiCall.duration = finishRequestTiming(requestId);
      apiCall.status = this.status || undefined;
      apiCall.statusText = this.statusText || undefined;
      if (this.status >= 400 || this.status === 0) {
        apiCall.error = this.statusText || "XMLHttpRequest failed";
      } else if (this.responseType === "" || this.responseType === "text") {
        apiCall.response = summarizeTrackedValue(this.responseText);
      } else {
        apiCall.response = summarizeTrackedValue(this.response);
      }
      dispatchApiCallUpdatedIfTracing(apiCall);
    };

    this.addEventListener("loadend", finish, { once: true });
    originalSend.call(this, body);
  };

  xmlHttpRequestTrackingPatched = true;

  return () => {
    prototype.open = originalOpen;
    prototype.send = originalSend;
    xmlHttpRequestTrackingPatched = false;
  };
}
