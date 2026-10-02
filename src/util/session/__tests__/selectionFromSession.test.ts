import { describe, expect, it } from "vitest";

import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import type { Session } from "@src/store/session/sessionAtom/types";

import { resolveModelForMessage } from "../resolveModelForMessage";
import { selectionFromSession } from "../selectionFromSession";

const fallback: LastModelSelection = {
  keySource: "own_key",
  model: "creator-model",
  selectedAccountId: "creator-account",
  cliAgentType: "codex",
};
const session: Session = {
  session_id: "session",
  created_at: "2026-09-23",
  updated_at: "2026-09-23",
  status: "idle",
  model: "session-model",
};

describe("session model identity", () => {
  it("uses a complete default only before a session has a model", () => {
    expect(selectionFromSession(undefined, fallback)).toBe(fallback);
    expect(
      selectionFromSession({ ...session, model: undefined }, fallback)
    ).toBe(fallback);
  });
  it("never sends a creator account alongside an existing session model", () => {
    const selected = selectionFromSession(session, fallback);
    expect(resolveModelForMessage(selected)).toEqual({
      model: "session-model",
      accountId: undefined,
    });
    expect(selected?.cliAgentType).toBeUndefined();
    expect(selected?.keySource).toBeUndefined();
  });
  it("preserves a Market credential without borrowing a personal account", () => {
    const selected = selectionFromSession(
      {
        ...session,
        keySource: "own_key",
        credentialSource: "market:selection",
      },
      fallback
    );
    expect(selected?.credentialSource).toBe("market:selection");
    expect(resolveModelForMessage(selected).accountId).toBeUndefined();
  });
  it("resolves hosted models from the session while excluding own-key routing", () => {
    expect(
      resolveModelForMessage(
        selectionFromSession({ ...session, keySource: "hosted_key" }, fallback)
      )
    ).toEqual({ model: "session-model", accountId: undefined });
  });
});
