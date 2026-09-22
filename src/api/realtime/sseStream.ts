/**
 * Server-Sent Events (SSE) Stream Handler
 *
 * Utility for handling SSE streams from Rust HTTP server.
 * Provides a simple interface for connecting to SSE endpoints and handling events.
 */
import { withIdeServerToken } from "@src/config/ideServer";
import { createLogger } from "@src/hooks/logger";
import { recordPushEvent } from "@src/util/monitoring/apiTracker";

import {
  parseSSEEndData,
  parseSSEErrorData,
  parseSSEOutputData,
  parseSSEStartData,
} from "./sseSchemas";
import type { SSEEndData, SSEErrorData, SSEOutputData } from "./sseSchemas";

const log = createLogger("SSE");

export interface SSEStreamOptions {
  url: string;
  onStart?: (data: unknown) => void;
  onOutput?: (data: SSEOutputData) => void;
  onEnd?: (data: SSEEndData) => void;
  /** Called on error with error message and optional error data from backend */
  onError?: (error: string, data?: SSEErrorData) => void;
}

/**
 * Create an SSE stream connection
 *
 * @param options - Stream configuration and callbacks
 * @returns Cleanup function to close the stream
 *
 * @example
 * ```typescript
 * const cleanup = createSSEStream({
 *   url: 'http://localhost:13847/api/git/repo/test/push/stream',
 *   onOutput: (data) => *
 * // Close the stream when needed
 * cleanup();
 * ```
 */
export function createSSEStream(options: SSEStreamOptions): () => void {
  const { url, onStart, onOutput, onEnd, onError } = options;

  // `EventSource` cannot set headers, so the local IDE server token rides in
  // the query string.
  const eventSource = new EventSource(withIdeServerToken(url));

  // Handle start event
  eventSource.addEventListener("start", (event) => {
    try {
      recordPushEvent("sse", "start");
      const data = parseSSEStartData(event.data);
      onStart?.(data);
    } catch (parseError) {
      log.error("[SSE] Failed to parse start event:", parseError);
    }
  });

  // Handle output event (stdout/stderr lines)
  eventSource.addEventListener("output", (event) => {
    try {
      recordPushEvent("sse", "output");
      const data = parseSSEOutputData(event.data);
      onOutput?.(data);
    } catch (parseError) {
      log.error("[SSE] Failed to parse output event:", parseError);
    }
  });

  // Handle end event
  eventSource.addEventListener("end", (event) => {
    try {
      recordPushEvent("sse", "end");
      const data = parseSSEEndData(event.data);
      onEnd?.(data);
      eventSource.close();
    } catch (parseError) {
      log.error("[SSE] Failed to parse end event:", parseError);
      eventSource.close();
    }
  });

  // Handle error event
  eventSource.addEventListener("error", (event: Event) => {
    try {
      recordPushEvent("sse", "error");
      // Check if error event has data
      const messageEvent = event as MessageEvent;
      if (messageEvent.data) {
        const data = parseSSEErrorData(messageEvent.data);
        onError?.(data.error, data);
      } else {
        // Connection error
        onError?.("Stream connection failed");
      }
    } catch (_e) {
      onError?.("Stream connection failed");
    }
    eventSource.close();
  });

  // Handle connection errors (network issues, server unreachable, etc.)
  eventSource.onerror = (_error) => {
    // Only log if the connection was open (avoid duplicate error on intentional close)
    if (eventSource.readyState !== EventSource.CLOSED) {
      log.error("[SSE] Connection error");
      onError?.("Connection lost", {
        error: "Connection lost",
        error_type: "network_error",
      });
    }
    eventSource.close();
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}
