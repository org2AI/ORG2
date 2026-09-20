// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { USER_B, authFor, signedInStore } from "./identity.test-utils";
import {
  invalidateMarketProfileCache,
  useMarketExecutionProfiles,
} from "./marketProfiles";
import type { Entry } from "./rpc";

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(),
  loadEntries: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@src/features/Org2Cloud/useOrg2CloudSignIn", () => ({
  openOrg2CloudSignIn: mocks.signIn,
}));
vi.mock("./rpc", () => ({ ...mocks, prepareSessionSource: vi.fn() }));
vi.mock("./usageAuthorization", () => ({ authorizedProfile: vi.fn() }));
const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  signedInStore();
  invalidateMarketProfileCache();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.loadConnections.mockResolvedValue({
    connections: [
      {
        identity_user_id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "ws_account_test",
        target: "org2",
        phase: "authorization_saved",
      },
    ],
  });
  mocks.loadEntries.mockResolvedValue([]);
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

function picker() {
  let enabled = true;
  let current: ReturnType<typeof useMarketExecutionProfiles>;
  const root = createRoot(document.createElement("div"));
  function Probe() {
    const value = useMarketExecutionProfiles({
      enabled,
      cliAgentType: "claude_code",
    });
    useEffect(() => {
      current = value;
    }, [value]);
    return null;
  }
  cleanup.push(() => act(() => root.unmount()));
  return {
    current: () => current!,
    async render(open: boolean) {
      enabled = open;
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store: getInstrumentedStore() },
            React.createElement(Probe)
          )
        );
      });
      return current!;
    },
  };
}

it("refreshes website package changes on app focus without a deep link or idle fetch", async () => {
  const view = picker();
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  await view.render(false);
  const entry: Entry = {
    workspace_id: "ws_purchase",
    entitlement_id: "pa_selected",
    service_id: "package-selected",
    service_name: "Selected Package",
    models: ["claude-sonnet-5"],
    models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
    status: "active",
    expires_at: null,
  };
  mocks.loadEntries.mockResolvedValue([entry]);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  expect(
    (await view.render(true)).profiles.map((profile) => profile.entitlementId)
  ).toEqual(["pa_selected"]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  await view.render(false);
  await view.render(true);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
});

it("projects identical package/model names as distinct picker sources with their original purchase bindings", async () => {
  const entries: Entry[] = ["b", "a"].map((suffix) => ({
    workspace_id: `ws_purchase_${suffix}`,
    entitlement_id: `pa_${suffix}`,
    service_id: `package_${suffix}`,
    service_name: "Claude Package",
    models: ["claude-sonnet-5"],
    models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
    status: "active",
    expires_at: null,
  }));
  mocks.loadEntries.mockResolvedValue(entries);
  const result = await picker().render(true);
  expect(
    result.sources.map((source) => ({
      label: source.label,
      workspace: source.profile.entitlementWorkspaceId,
      purchase: source.profile.entitlementId,
    }))
  ).toEqual([
    {
      label: "Claude Package · 2/2",
      workspace: "ws_purchase_b",
      purchase: "pa_b",
    },
    {
      label: "Claude Package · 1/2",
      workspace: "ws_purchase_a",
      purchase: "pa_a",
    },
  ]);
  expect(new Set(result.sources.map((source) => source.id)).size).toBe(2);
});

it("hides a rendered old-owner catalog immediately and loads only the new owner's entries", async () => {
  mocks.loadEntries.mockResolvedValue([
    {
      workspace_id: "ws_purchase",
      entitlement_id: "pa_one",
      service_id: "pkg_one",
      service_name: "One",
      models: ["gpt"],
      models_by_agent: { claude: ["gpt"], codex: [] },
      status: "active",
      expires_at: null,
    },
  ]);
  const view = picker();
  expect((await view.render(true)).profiles).toHaveLength(1);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, authFor(USER_B));
  });
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, null);
  });
  const loggedOut = await view.render(true);
  expect(loggedOut.profiles).toEqual([]);
  expect(loggedOut.loading).toBe(false);
});

it("invalidates already rendered rows through a React-batched A to B to A transition", async () => {
  mocks.loadEntries.mockResolvedValue([
    {
      workspace_id: "ws_purchase",
      entitlement_id: "pa_one",
      service_id: "pkg_one",
      service_name: "One",
      models: ["gpt"],
      models_by_agent: { claude: ["gpt"], codex: [] },
      status: "active",
      expires_at: null,
    },
  ]);
  const view = picker();
  expect((await view.render(true)).profiles).toHaveLength(1);
  mocks.loadEntries.mockResolvedValue([]);
  await act(async () => {
    getInstrumentedStore().set(org2CloudAuthAtom, authFor(USER_B));
    getInstrumentedStore().set(org2CloudAuthAtom, authFor());
  });
  expect((await view.render(true)).profiles).toEqual([]);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
});

for (const secondEnabled of [false, true]) {
  it(`shares one focus refresh with another ${secondEnabled ? "open" : "closed"} picker`, async () => {
    const first = picker();
    const second = picker();
    await first.render(true);
    await second.render(secondEnabled);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
    mocks.loadEntries.mockResolvedValue([
      {
        workspace_id: "ws_purchase",
        entitlement_id: "pa_focused",
        service_id: "pkg_focused",
        service_name: "Focused package",
        models: ["claude-sonnet-5"],
        models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
        status: "active",
        expires_at: null,
      },
    ]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      (await first.render(true)).profiles.map(
        (profile) => profile.entitlementId
      )
    ).toEqual(["pa_focused"]);
    expect(
      (await second.render(true)).profiles.map(
        (profile) => profile.entitlementId
      )
    ).toEqual(["pa_focused"]);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  });
}

it("updates an already open picker when its pending catalog settles", async () => {
  let finish!: (entries: Entry[]) => void;
  mocks.loadEntries.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = picker();
  await view.render(true);
  expect(view.current().loading).toBe(true);
  await act(async () => {
    finish([
      {
        workspace_id: "ws_purchase",
        entitlement_id: "pa_async",
        service_id: "pkg_async",
        service_name: "Async Package",
        models: ["claude-sonnet-5"],
        models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
        status: "active",
        expires_at: null,
      },
    ]);
  });
  expect(view.current().loading).toBe(false);
  expect(view.current().profiles).toHaveLength(1);
});

it("shares an in-flight catalog across focus events without invalidation", async () => {
  let finish!: (entries: Entry[]) => void;
  mocks.loadEntries.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = picker();
  const closed = picker();
  await view.render(true);
  await closed.render(false);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(view.current().loading).toBe(true);
  const entry: Entry = {
    workspace_id: "ws_purchase",
    entitlement_id: "pa_async",
    service_id: "pkg_async",
    service_name: "Async Package",
    models: ["claude-sonnet-5"],
    models_by_agent: { claude: ["claude-sonnet-5"], codex: [] },
    status: "active",
    expires_at: null,
  };
  mocks.loadEntries.mockResolvedValue([entry]);
  await act(async () => {
    finish([entry]);
  });
  expect(view.current().loading).toBe(false);
  expect(view.current().profiles).toHaveLength(1);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
});

it("bounds picker waiting without replaying the shared request, and retries explicitly", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (entries: Entry[]) => void;
    mocks.loadEntries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = picker();
    await view.render(true);
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        if (i < 5) window.dispatchEvent(new Event("focus"));
      });
    }

    expect(view.current().loading).toBe(false);
    expect(view.current().error).toBe("market_catalog_load_timeout");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
    let retry!: Promise<void>;
    await act(async () => {
      retry = view.current().refresh();
    });
    expect(view.current().loading).toBe(true);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish([]);
      await retry;
    });
    expect(view.current().loading).toBe(false);
    expect(view.current().error).toBeNull();
    expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("does not overwrite the timeout with a late catalog until explicit retry", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (entries: Entry[]) => void;
    mocks.loadEntries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = picker();
    await view.render(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {
      finish([]);
    });
    expect(view.current().error).toBe("market_catalog_load_timeout");
    expect(view.current().loading).toBe(false);
    await act(async () => {
      await view.current().refresh();
    });
    expect(view.current().error).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("disposes an old-owner wait and never shows its timeout after logout", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (entries: Entry[]) => void;
    mocks.loadEntries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = picker();
    await view.render(true);
    await act(async () => {
      getInstrumentedStore().set(org2CloudAuthAtom, null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      finish([]);
    });
    expect(view.current().loading).toBe(false);
    expect(view.current().error).toBeNull();
    expect(view.current().profiles).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("reuses a fresh catalog on repeated focus without another request", async () => {
  const view = picker();
  await view.render(true);
  await act(async () => {
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus"));
  });
  expect(view.current().loading).toBe(false);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
});

it.each(["event", "refresh"])(
  "coalesces %s invalidation during a pending read without publishing stale entries",
  async (kind) => {
    let finish!: (entries: Entry[]) => void;
    mocks.loadEntries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = picker(),
      second = picker(),
      closed = picker();
    await first.render(true);
    await second.render(true);
    await closed.render(false);
    let refresh: Promise<void> | undefined;
    await act(async () => {
      if (kind === "event") {
        for (let i = 0; i < 5; i++)
          window.dispatchEvent(new Event("market-profiles-changed"));
      } else {
        refresh = first.current().refresh();
        void first.current().refresh();
      }
    });
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish([
        {
          workspace_id: "ws_purchase",
          entitlement_id: "pa_old",
          service_id: "old",
          service_name: "Removed package",
          models: ["model"],
          models_by_agent: { claude: ["model"], codex: [] },
          status: "active",
          expires_at: null,
        },
      ]);
      await refresh;
    });
    expect(first.current().profiles).toEqual([]);
    expect(second.current().profiles).toEqual([]);
    expect(first.current().loading).toBe(false);
    expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
  }
);

it("does not duplicate an event refresh across open and closed pickers", async () => {
  const first = picker(),
    second = picker(),
    closed = picker();
  await first.render(true);
  await second.render(true);
  await closed.render(false);
  await act(async () => {
    window.dispatchEvent(new Event("market-profiles-changed"));
  });
  expect(mocks.loadEntries).toHaveBeenCalledTimes(2);
});

it.each(["close", "timeout"])(
  "does not continue an invalidated read after %s",
  async (stop) => {
    vi.useFakeTimers();
    try {
      let finish!: (entries: Entry[]) => void;
      mocks.loadEntries.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const view = picker();
      await view.render(true);
      await act(async () => {
        window.dispatchEvent(new Event("market-profiles-changed"));
      });
      if (stop === "close") await view.render(false);
      else
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
      await act(async () => {
        finish([]);
      });
      expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
      if (stop === "timeout")
        expect(view.current().error).toBe("market_catalog_load_timeout");
    } finally {
      vi.useRealTimers();
    }
  }
);

it("upgrades a legacy login only on explicit retry, then refreshes mounted pickers", async () => {
  mocks.loadConnections.mockRejectedValueOnce(
    Error("market_reauthorization_required")
  );
  const view = picker();
  await view.render(true);
  expect(mocks.signIn).not.toHaveBeenCalled();
  mocks.signIn.mockImplementationOnce(
    async ({ onSignedIn }: { onSignedIn: () => void }) => {
      getInstrumentedStore().set(org2CloudAuthAtom, {
        ...authFor(),
        oauthClientId: USER_B,
      });
      onSignedIn();
    }
  );
  await act(async () => {
    await view.current().refresh();
  });
  expect(mocks.signIn).toHaveBeenCalledTimes(1);
  expect(view.current().error).toBeNull();
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
});

it("does not start a follow-up read after a timed-out retry is closed", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (entries: Entry[]) => void;
    mocks.loadEntries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = picker();
    await view.render(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {
      void view.current().refresh();
    });
    await view.render(false);
    await act(async () => {
      finish([]);
    });
    expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("rereads an invalidated catalog even when the obsolete request fails", async () => {
  let reject!: (error: Error) => void;
  mocks.loadConnections.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  const view = picker();
  await view.render(true);
  await act(async () => {
    window.dispatchEvent(new Event("market-profiles-changed"));
    reject(Error("market_request_failed"));
  });
  expect(view.current().error).toBeNull();
  expect(view.current().loading).toBe(false);
  expect(mocks.loadConnections).toHaveBeenCalledTimes(2);
  expect(mocks.loadEntries).toHaveBeenCalledTimes(1);
});
