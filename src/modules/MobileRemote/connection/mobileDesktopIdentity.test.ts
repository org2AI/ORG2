import { describe, expect, it } from "vitest";

import {
  desktopIdentityName,
  parseDesktopIdentity,
  withInitializedDesktop,
} from "./mobileDesktopIdentity";
import {
  activePairingConfig,
  parsePairingInventory,
  summarizePairingInventory,
  updatePairingInventory,
} from "./mobilePairedDesktopInventory";

describe("desktop metadata ownership", () => {
  const config = {
    host: "office.local",
    port: 8765,
    deviceLabel: "Alex's iPhone",
    deviceToken: "private-token",
  };
  const identity = { name: "Office Mac", model: "Mac14,7", username: "alex" };

  it("hydrates confirmed metadata without changing pairing ID, credentials or phone label", () => {
    const initial = updatePairingInventory(
      parsePairingInventory(null),
      config,
      1
    );
    expect(initial.desktops[0].name).toBe("office.local");
    const identified = withInitializedDesktop(config, {
      desktopId: "desktop-process-42",
      desktopIdentity: identity,
    });
    const saved = updatePairingInventory(initial, identified, 2);
    const reloaded = parsePairingInventory(JSON.stringify(saved));
    expect(reloaded.desktops).toHaveLength(1);
    expect(reloaded.activeDesktopId).toBe(initial.activeDesktopId);
    expect(activePairingConfig(reloaded)).toEqual({
      ...config,
      desktopIdentity: identity,
    });
    expect(summarizePairingInventory(reloaded)[0]).toMatchObject({
      name: "Office Mac",
      desktopIdentity: identity,
    });
    expect(JSON.stringify(summarizePairingInventory(reloaded))).not.toContain(
      "private-token"
    );
    expect(JSON.stringify(summarizePairingInventory(reloaded))).not.toContain(
      "Alex's iPhone"
    );
  });

  it("preserves known labels across old-server reconnect and updates only the same pairing", () => {
    const known = withInitializedDesktop(config, { desktopIdentity: identity });
    expect(withInitializedDesktop(known, {})).toBe(known);
    expect(withInitializedDesktop(known, { desktopIdentity: identity })).toBe(
      known
    );
    const initial = updatePairingInventory(
      parsePairingInventory(null),
      known,
      1
    );
    const another = updatePairingInventory(
      initial,
      { wsUrl: "wss://elsewhere.test", desktopId: "other" },
      2
    );
    const updated = updatePairingInventory(
      another,
      withInitializedDesktop(known, { desktopName: "Renamed Mac" }),
      3
    );
    expect(updated.desktops[0].name).toBe("Renamed Mac");
    expect(updated.desktops[0].config.desktopIdentity).toEqual({
      ...identity,
      name: "Renamed Mac",
    });
    expect(updated.desktops[1]).toEqual(another.desktops[0]);
  });

  it("accepts partial labels, rejects malformed values, and never fabricates a model", () => {
    expect(
      parseDesktopIdentity({ name: ["bad"], model: 42, username: "\u0000" })
    ).toBeUndefined();
    expect(
      parseDesktopIdentity({ username: " alex ", serialNumber: "do-not-copy" })
    ).toEqual({ username: "alex" });
    expect(desktopIdentityName({ model: "Mac14,7", username: "alex" })).toBe(
      "Mac14,7 · alex"
    );
    expect(
      withInitializedDesktop(config, {
        desktopIdentity: null,
        desktopName: " Old Mac ",
      }).desktopIdentity
    ).toEqual({ name: "Old Mac" });
    expect(parseDesktopIdentity({ name: "机".repeat(200) })?.name).toHaveLength(
      128
    );
  });
});
