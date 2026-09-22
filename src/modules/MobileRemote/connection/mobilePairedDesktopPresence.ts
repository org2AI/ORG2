import type { DesktopPresence, MobilePairedDesktopSummary } from "./types";

export interface PairedDesktopPresence {
  id: string;
  name: string;
  details?: string;
  presence: DesktopPresence;
  current: boolean;
}

/**
 * Pairing storage records selection, not presence. Only the selected desktop
 * has a live transport observation; other saved desktops are not probed.
 * Never persist this projection or infer availability from updatedAtMs.
 */
export function derivePairedDesktopPresence(input: {
  desktops: MobilePairedDesktopSummary[];
  activePresence: DesktopPresence;
}): PairedDesktopPresence[] {
  return input.desktops.map((desktop) => ({
    id: desktop.id,
    name: desktop.name,
    details:
      [desktop.desktopIdentity?.model, desktop.desktopIdentity?.username]
        .filter(Boolean)
        .join(" · ") || undefined,
    presence: desktop.active ? input.activePresence : "unknown",
    current: desktop.active,
  }));
}
