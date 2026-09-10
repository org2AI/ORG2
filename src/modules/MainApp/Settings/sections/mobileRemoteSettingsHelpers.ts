import type { TFunction } from "i18next";

export function generateMobileRemoteLanToken(): string {
  return crypto.randomUUID();
}

export function isMobileRemoteRelayUrlConfigured(relayUrl: string): boolean {
  return /^wss?:\/\//.test(relayUrl.trim());
}

export function isMobileRemoteRelayReady(args: {
  relayUrl: string;
  cloudSignedIn: boolean;
}): boolean {
  return isMobileRemoteRelayUrlConfigured(args.relayUrl) && args.cloudSignedIn;
}

function isRelayAuthFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("401") ||
    lower.includes("auth_required") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid desktop token") ||
    lower.includes("invalid token") ||
    lower.includes("desktop relay token")
  );
}

/** Map relay authentication errors to actionable ORG2 Cloud guidance. */
export function formatMobileRemoteRelayStatusMessage(
  message: string | null | undefined,
  cloudSignedIn: boolean,
  t: TFunction<"settings">
): string | null {
  if (!message?.trim()) {
    return null;
  }
  const trimmed = message.trim();
  if (isRelayAuthFailureMessage(trimmed)) {
    return cloudSignedIn
      ? t("mobileRemote.relayStatusAuthFailedSignedIn")
      : t("mobileRemote.relayStatusCloudLoginRequired");
  }
  return trimmed;
}
