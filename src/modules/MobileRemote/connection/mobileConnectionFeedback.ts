import type { MobileRpcError } from "./types";

/** Product copy is selected by locally produced categories, never remote text. */
export function mobileConnectionFailureKey(error?: MobileRpcError) {
  switch (error?.connectionIssue) {
    case "ticket":
      return "connectionFeedback.ticket";
    case "authorization":
      return "connectionFeedback.authorization";
    default:
      return "connectionFeedback.unavailable";
  }
}
