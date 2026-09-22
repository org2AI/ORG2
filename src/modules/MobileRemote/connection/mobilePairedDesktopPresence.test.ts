import { describe, expect, it } from "vitest";

import {
  parsePairingInventory,
  selectPairingInventory,
  summarizePairingInventory,
  updatePairingInventory,
} from "./mobilePairedDesktopInventory";
import { derivePairedDesktopPresence } from "./mobilePairedDesktopPresence";

describe("derivePairedDesktopPresence", () => {
  it("does not invent devices from an online transport", () => {
    expect(
      derivePairedDesktopPresence({ desktops: [], activePresence: "online" })
    ).toEqual([]);
  });

  it.each(["online", "offline", "unknown"] as const)(
    "only associates %s with the selected desktop, never with other saved pairings",
    (activePresence) => {
      const desktops = [
        { id: "home", name: "Home Mac", active: true, updatedAtMs: 1 },
        {
          id: "office",
          name: "Office Mac",
          active: false,
          updatedAtMs: Date.now(),
        },
      ];
      expect(derivePairedDesktopPresence({ desktops, activePresence })).toEqual(
        [
          {
            id: "home",
            name: "Home Mac",
            current: true,
            presence: activePresence,
          },
          {
            id: "office",
            name: "Office Mac",
            current: false,
            presence: "unknown",
          },
        ]
      );
      expect(desktops[1]).not.toHaveProperty("presence");
    }
  );

  it("preserves the invariant through real pairing writes, reload, selection and deselection", () => {
    const home = updatePairingInventory(
      parsePairingInventory(null),
      {
        desktopId: "home",
        deviceLabel: "Home Mac",
        wsUrl: "wss://home.example/ws",
      },
      1
    );
    const office = updatePairingInventory(
      home,
      {
        desktopId: "office",
        deviceLabel: "Office Mac",
        wsUrl: "wss://office.example/ws",
      },
      2
    );
    const reloaded = parsePairingInventory(JSON.stringify(office));
    const project = (inventory: typeof reloaded) =>
      derivePairedDesktopPresence({
        desktops: summarizePairingInventory(inventory),
        activePresence: "online",
      });
    expect(project(reloaded).map(({ presence }) => presence)).toEqual([
      "online",
      "unknown",
    ]);
    const selected = selectPairingInventory(reloaded, "home")!;
    expect(project(selected.inventory).map(({ presence }) => presence)).toEqual(
      ["unknown", "online"]
    );
    const cleared = updatePairingInventory(selected.inventory, null, 3);
    expect(project(cleared).map(({ presence }) => presence)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(JSON.stringify(cleared)).not.toContain("presence");
    expect(reloaded.activeDesktopId).toBe("office");
  });
});
