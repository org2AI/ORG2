import type { MobilePermissionTier } from "./types";

export function resolvePermissionTierLabel(
  tier: MobilePermissionTier | undefined,
  t: (key: string) => string
): string {
  switch (tier) {
    case "full":
      return t("settings.permissionFull");
    case "read_only":
      return t("settings.permissionReadOnly");
    default:
      return t("settings.notAvailable");
  }
}
