// @vitest-environment jsdom
import { type PrimitiveAtom, getDefaultStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  org2CloudOrgsAtom,
  org2CloudOrgsLoadedAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials/guideTargets";
import { runtimeNavigationIntentAtom } from "@src/store/ui/runtimeNavigationAtom";

import RuntimeDataSourcePanel from ".";

// Read-only in production — derived from the sidebar's selection — but this
// file mocks the module with a primitive atom so a test can pin the sidebar's
// active cloud organization before the panel mounts.
const sidebarCloudOrgIdAtom =
  sidebarActiveCloudOrgIdAtom as unknown as PrimitiveAtom<string | null>;

const lifecycle = vi.hoisted(() => ({
  usageUnmounted: vi.fn(),
  scanningUnmounted: vi.fn(),
  hooksUnmounted: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/features/Org2Cloud/org2CloudAuthAtom", async () => {
  const { atom } = await import("jotai");
  return { org2CloudAuthAtom: atom(null) };
});

vi.mock("@src/features/Org2Cloud/org2CloudOrgsAtom", async () => {
  const { atom } = await import("jotai");
  return {
    org2CloudOrgsAtom: atom([]),
    org2CloudOrgsLoadedAtom: atom(true),
    sidebarActiveCloudOrgIdAtom: atom(null),
    buildCloudOrgSelectorValue: (orgId: string) => `cloud:${orgId}`,
    parseCloudOrgSelectorValue: (value: string) =>
      value.startsWith("cloud:") ? value.slice("cloud:".length) : null,
  };
});

vi.mock("@src/components/Select", () => ({
  default: ({
    value,
    options = [],
    onChange,
    dataTestId,
  }: {
    value?: unknown;
    options?: Array<{ value: unknown; label: string }>;
    onChange?: (value: unknown) => void;
    dataTestId?: string;
  }) =>
    createElement(
      "select",
      {
        value: String(value),
        "data-testid": dataTestId,
        onChange: (event: { target: { value: string } }) =>
          onChange?.(event.target.value),
      },
      options.map((option) =>
        createElement(
          "option",
          { key: String(option.value), value: String(option.value) },
          option.label
        )
      )
    ),
}));

// The panel's Suspense fallback. The real Placeholder debounces its loading
// spinner, so render a marker straight away: settleLazySections uses it to
// tell whether a lazy section is still pending.
vi.mock("@src/components/Placeholder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/components/Placeholder")>()),
  Placeholder: () =>
    createElement("div", { "data-testid": "runtime-lazy-fallback" }),
}));

vi.mock("./TeamRuntimePanel", () => ({
  default: ({ orgId, view }: { orgId?: string; view?: string }) =>
    createElement("div", {
      "data-testid": "runtime-section-organization",
      "data-org-id": orgId,
      "data-view": view,
    }),
}));

vi.mock(
  "@src/engines/ChatPanel/panels/CloudOrgPanelView/CloudOrgSyncTab",
  () => ({
    default: ({ orgId }: { orgId: string }) =>
      createElement("div", {
        "data-testid": "runtime-section-org-sync",
        "data-org-id": orgId,
      }),
  })
);

vi.mock("./SessionUsagePanel", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  function UsageSectionMock() {
    React.useEffect(() => lifecycle.usageUnmounted, []);
    return React.createElement("div", {
      "data-testid": "runtime-section-usage",
    });
  }
  return {
    default: UsageSectionMock,
  };
});

vi.mock("./RuntimeScanningPanel", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  function ScanningSectionMock() {
    React.useEffect(() => lifecycle.scanningUnmounted, []);
    return React.createElement("div", {
      "data-testid": "runtime-section-scanning",
    });
  }
  return {
    default: ScanningSectionMock,
  };
});

vi.mock("./SessionProvenanceHooksPanel", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  function HooksSectionMock() {
    React.useEffect(() => lifecycle.hooksUnmounted, []);
    return React.createElement("div", {
      "data-testid": "runtime-section-hooks",
    });
  }
  return {
    default: HooksSectionMock,
  };
});

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const store = getDefaultStore();

describe("RuntimeDataSourcePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  const CLOUD_AUTH = {
    kind: "org2_cloud" as const,
    supabaseUrl: "https://cloud.example",
    supabaseAnonKey: "anon",
    userId: "me",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };

  // Waits until the lazy section that the last update requested is on
  // screen and the section it replaced has run its cleanup.
  //
  // A lazy section swaps in through a Suspense retry. React commits that
  // retry immediately only while an act() scope is open. Outside act(), it
  // holds a reveal that replaces a just-shown fallback for
  // FALLBACK_THROTTLE_MS (300 ms) and commits it from a timer.
  // vi.dynamicImportSettled() does not wait for this file's async vi.mock
  // factories, so on a loaded runner a section's import can finish after
  // the act() below has closed. Asserting right after it then sees the old
  // section still mounted (hidden) and the new one missing.
  const settleLazySections = async () => {
    await act(async () => {
      await vi.dynamicImportSettled();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await vi.waitFor(
      () => {
        expect(
          container.querySelector('[data-testid="runtime-lazy-fallback"]')
        ).toBeNull();
      },
      { timeout: 5_000 }
    );
    // A retry committed from React's timer runs passive effect cleanups in a
    // later task; flush them before callers assert on lifecycle mocks.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  beforeEach(async () => {
    store.set(org2CloudAuthAtom, null);
    store.set(org2CloudOrgsAtom, []);
    store.set(org2CloudOrgsLoadedAtom, true);
    store.set(sidebarCloudOrgIdAtom, null);
    store.set(runtimeNavigationIntentAtom, null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    await act(async () => {
      root.render(createElement(RuntimeDataSourcePanel));
    });
    await settleLazySections();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    vi.unstubAllGlobals();
  });

  // Scope is a local | cloud segmented switch; the organization selector next
  // to it appears only when the active scope has more than one organization.
  const selectCloudScope = async () => {
    const segments = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="runtime-scope-picker-scope"] button'
    );
    expect(segments).toHaveLength(2);
    await act(async () => {
      segments[1]?.click();
    });
    await settleLazySections();
  };

  const selectSection = async (testId: string) => {
    const button = container.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    await settleLazySections();
  };

  it("mounts only the active lazy section and disposes it on navigation", async () => {
    expect(
      container.querySelector('[data-testid="runtime-section-usage"]')
    ).not.toBeNull();

    await selectSection("data-source-view-scanning");
    expect(lifecycle.usageUnmounted).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="runtime-section-usage"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="runtime-section-scanning"]')
    ).not.toBeNull();

    await selectSection("data-source-view-hooks");
    expect(lifecycle.scanningUnmounted).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="runtime-section-hooks"]')
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid^="runtime-section-"]')
    ).toHaveLength(1);
  });

  it("preserves the Runtime navigation and scroll ownership", () => {
    const picker = container.innerHTML.indexOf("runtime-scope-picker");
    const usage = container.innerHTML.indexOf("data-source-view-usage");
    const profile = container.innerHTML.indexOf("data-source-view-profile");
    const scanning = container.innerHTML.indexOf("data-source-view-scanning");
    const hooks = container.innerHTML.indexOf("data-source-view-hooks");

    expect(picker).toBeGreaterThanOrEqual(0);
    expect(usage).toBeGreaterThan(picker);
    expect(profile).toBeGreaterThan(usage);
    expect(scanning).toBeGreaterThan(profile);
    expect(hooks).toBeGreaterThan(scanning);
    expect(
      container.querySelector('[data-testid="data-source-scroll-region"]')
        ?.className
    ).toContain("overflow-y-auto");
  });

  it("keeps type categories out of the Runtime tab bar", () => {
    expect(
      container.querySelector('[data-testid="data-source-view-types"]')
    ).toBeNull();
  });

  it("consolidates Quota into Usage instead of rendering a separate tab", () => {
    expect(
      container.querySelector('[data-testid="data-source-view-quota"]')
    ).toBeNull();
  });

  it("switches from Personal tabs to the selected organization's Today and Members tabs", async () => {
    await act(async () => {
      store.set(org2CloudAuthAtom, CLOUD_AUTH);
      store.set(org2CloudOrgsAtom, [
        { orgId: "org-1", name: "Example Team", role: "member" },
      ]);
    });

    // One cloud organization: the switch alone carries the scope, so no
    // organization selector is rendered next to it.
    expect(
      container.querySelector('[data-testid="runtime-scope-picker"]')
    ).toBeNull();
    await selectCloudScope();

    expect(
      container.querySelector('[data-testid="data-source-view-usage"]')
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="data-source-view-org-today"]')
        ?.getAttribute("data-active")
    ).toBe("true");
    const orgPanel = container.querySelector(
      '[data-testid="runtime-section-organization"]'
    );
    expect(orgPanel?.getAttribute("data-org-id")).toBe("org-1");
    expect(orgPanel?.getAttribute("data-view")).toBe("today");

    await selectSection("data-source-view-org-members");
    expect(
      container
        .querySelector('[data-testid="runtime-section-organization"]')
        ?.getAttribute("data-view")
    ).toBe("members");

    // Sync is the org-management Sync tab rendered here, so it takes the org
    // id directly instead of a TeamRuntimePanel view.
    await selectSection("data-source-view-org-sync");
    expect(
      container.querySelector('[data-testid="runtime-section-organization"]')
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="runtime-section-org-sync"]')
        ?.getAttribute("data-org-id")
    ).toBe("org-1");
  });

  it("opens on the local scope even when the sidebar is filtered to a cloud organization", async () => {
    await act(async () => {
      store.set(org2CloudAuthAtom, CLOUD_AUTH);
      store.set(org2CloudOrgsAtom, [
        { orgId: "org-1", name: "Example Team", role: "member" },
      ]);
      store.set(sidebarCloudOrgIdAtom, "org-1");
    });
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(createElement(RuntimeDataSourcePanel));
    });
    await settleLazySections();

    expect(
      container.querySelector('[data-testid="runtime-section-usage"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="runtime-section-organization"]')
    ).toBeNull();
    const segments = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="runtime-scope-picker-scope"] button'
    );
    expect(segments[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers an organization selector beside the switch once the cloud scope holds more than one organization", async () => {
    await act(async () => {
      store.set(org2CloudAuthAtom, CLOUD_AUTH);
      store.set(org2CloudOrgsAtom, [
        { orgId: "org-1", name: "Example Team", role: "member" },
        { orgId: "org-2", name: "Second Team", role: "member" },
      ]);
    });
    await selectCloudScope();

    const scopePicker = container.querySelector<HTMLSelectElement>(
      '[data-testid="runtime-scope-picker"]'
    );
    expect(scopePicker).not.toBeNull();
    expect(
      Array.from(scopePicker?.querySelectorAll("option") ?? []).map(
        (option) => option.value
      )
    ).toEqual(["cloud:org-1", "cloud:org-2"]);

    await act(async () => {
      if (!scopePicker) return;
      scopePicker.value = "cloud:org-2";
      scopePicker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settleLazySections();

    expect(
      container
        .querySelector('[data-testid="runtime-section-organization"]')
        ?.getAttribute("data-org-id")
    ).toBe("org-2");
  });

  it("consumes a guide intent and opens the requested organization's Members view", async () => {
    await act(async () => {
      store.set(org2CloudAuthAtom, CLOUD_AUTH);
      store.set(org2CloudOrgsAtom, [
        { orgId: "org-1", name: "Example Team", role: "member" },
      ]);
      store.set(runtimeNavigationIntentAtom, {
        requestId: 42,
        scope: "organization",
        orgId: "org-1",
        view: "members",
      });
    });
    await settleLazySections();

    expect(
      container
        .querySelector('[data-testid="data-source-view-org-members"]')
        ?.getAttribute("data-active")
    ).toBe("true");
    expect(
      container
        .querySelector('[data-testid="runtime-section-organization"]')
        ?.getAttribute("data-org-id")
    ).toBe("org-1");
    expect(
      container
        .querySelector('[data-testid="runtime-section-organization"]')
        ?.getAttribute("data-view")
    ).toBe("members");
    expect(
      container.querySelector(
        `[data-guide-target="${GUIDE_TARGETS.TEAM_RUNTIME_TABS}"]`
      )
    ).not.toBeNull();
    expect(store.get(runtimeNavigationIntentAtom)).toBeNull();
  });

  it("drops an intent for a removed organization without changing the personal view", async () => {
    await act(async () => {
      store.set(runtimeNavigationIntentAtom, {
        requestId: 43,
        scope: "organization",
        orgId: "removed-org",
        view: "members",
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="runtime-section-usage"]')
    ).not.toBeNull();
    expect(
      container.querySelector(
        `[data-guide-target="${GUIDE_TARGETS.TEAM_RUNTIME_TABS}"]`
      )
    ).toBeNull();
    expect(store.get(runtimeNavigationIntentAtom)).toBeNull();
  });

  it("consumes a scanning intent and returns from an organization scope to the personal Scanning tab", async () => {
    await act(async () => {
      store.set(org2CloudAuthAtom, CLOUD_AUTH);
      store.set(org2CloudOrgsAtom, [
        { orgId: "org-1", name: "Example Team", role: "member" },
      ]);
    });
    await selectCloudScope();
    expect(
      container.querySelector('[data-testid="runtime-section-organization"]')
    ).not.toBeNull();

    await act(async () => {
      store.set(runtimeNavigationIntentAtom, {
        requestId: 44,
        scope: "personal",
        view: "scanning",
      });
    });
    await settleLazySections();

    expect(
      container.querySelector('[data-testid="runtime-section-scanning"]')
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="data-source-view-scanning"]')
        ?.getAttribute("data-active")
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="runtime-section-organization"]')
    ).toBeNull();
    expect(store.get(runtimeNavigationIntentAtom)).toBeNull();
  });

  it("opens Scanning without waiting for cloud organizations to load", async () => {
    await act(async () => {
      store.set(org2CloudOrgsLoadedAtom, false);
      store.set(runtimeNavigationIntentAtom, {
        requestId: 45,
        scope: "personal",
        view: "scanning",
      });
    });
    await settleLazySections();

    expect(
      container.querySelector('[data-testid="runtime-section-scanning"]')
    ).not.toBeNull();
    expect(store.get(runtimeNavigationIntentAtom)).toBeNull();
  });
});
