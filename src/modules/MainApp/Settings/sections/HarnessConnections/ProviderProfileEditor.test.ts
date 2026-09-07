// @vitest-environment jsdom
import React, { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HarnessConnectionView,
  HarnessProviderProfile,
} from "@src/api/tauri/rpc/schemas/agentOrgs";

import ProviderProfileEditor from "./ProviderProfileEditor";
import { refreshHarnessConnections } from "./useHarnessConnection";
import { newProviderProfile } from "./useProviderProfileEditor";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  fetchModels: vi.fn(),
  test: vi.fn(),
  apply: vi.fn(),
  cancelTest: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    agentOrgs: {
      connections: mocks,
      managedConfig: { restoreDefault: mocks.restore },
    },
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Native controls keep user events observable; the production form and controller run unchanged.
vi.mock("@src/components/Select", () => ({
  default: ({
    ariaLabel,
    options,
    value,
    disabled,
    onChange,
  }: {
    ariaLabel: string;
    options: { value: string; label: string; disabled?: boolean }[];
    value: string;
    disabled: boolean;
    onChange: (v: string) => void;
  }) =>
    createElement(
      "select",
      {
        "aria-label": ariaLabel,
        value,
        disabled,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onChange(e.target.value),
      },
      options.map((o) =>
        createElement(
          "option",
          { key: o.value, value: o.value, disabled: o.disabled },
          o.label
        )
      )
    ),
}));
let container: HTMLDivElement;
let root: Root;
let view: HarnessConnectionView;
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function input(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`
  )!;
  expect(element).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount(target: HarnessProviderProfile["target"] = "claude_code") {
  await act(async () =>
    root.render(
      createElement(ProviderProfileEditor, { target, onAdd: vi.fn() })
    )
  );
}
async function createAndSave() {
  await click("claudeProfiles.new");
  await click("claudeProfiles.save");
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  view = {
    installed: true,
    profiles: [],
    appliedProfile: null,
    config: {
      agentName: "claude_code",
      supported: true,
      mode: "default",
      hasDefaultBackup: false,
      conflict: false,
      selectedKeyId: null,
      selectedModel: null,
      selectedProvider: null,
      proxyUrl: null,
      message: null,
      targetFiles: [],
    },
    choices: [
      {
        keyId: "key",
        name: "Gateway",
        models: ["vendor/model"],
        endpoint: "https://gateway.example",
        requiresTest: true,
        reason: null,
      },
    ],
  };
  mocks.status.mockImplementation(async () => structuredClone(view));
  mocks.saveProfile.mockImplementation(
    async ({ profile }: { profile: HarnessProviderProfile }) => {
      const saved = { ...profile, revision: profile.revision + 1 };
      view.profiles = [saved];
      return saved;
    }
  );
  mocks.test.mockResolvedValue("receipt");
  mocks.apply.mockImplementation(async () => view.config);
  mocks.cancelTest.mockResolvedValue(undefined);
  mocks.fetchModels.mockResolvedValue(["custom/manual"]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  refreshHarnessConnections();
});

describe("ProviderProfileEditor", () => {
  it("renders mapping rows and saves without applying, then requires tests for activation", async () => {
    await mount();
    await click("claudeProfiles.new");
    expect(
      container.querySelector(
        'input[aria-label="Subagent claudeProfiles.requestModel"]'
      )
    ).not.toBeNull();
    await input("Opus claudeProfiles.requestModel", "vendor/opus");
    await input("Opus claudeProfiles.displayName", "Visible Opus");
    expect(button("harnessConnections.apply").disabled).toBe(true);
    await click("claudeProfiles.save");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(
      mocks.saveProfile.mock.calls[0][0].profile.models.roles.opus
    ).toEqual({
      model: "vendor/opus",
      displayName: "Visible Opus",
      context1m: false,
    });
    await click("claudeProfiles.test");
    expect(button("harnessConnections.apply").disabled).toBe(false);
    await click("harnessConnections.apply");
    expect(mocks.apply.mock.calls[0][0]).toMatchObject({
      agentName: "claude_code",
      receipt: "receipt",
      routing: "direct",
      profile: { revision: 1 },
    });
  });
  it("invalidates test evidence for endpoint and role changes", async () => {
    await mount();
    await createAndSave();
    await click("claudeProfiles.test");
    await input("harnessConnections.endpoint", "https://another.example");
    expect(button("harnessConnections.apply").disabled).toBe(true);
    await click("claudeProfiles.save");
    await click("claudeProfiles.test");
    await input("Sonnet claudeProfiles.displayName", "Changed label");
    expect(button("harnessConnections.apply").disabled).toBe(true);
  });
  it("uses one model for all roles and keeps Subagent labels absent", async () => {
    await mount();
    await click("claudeProfiles.new");
    await input("Sonnet claudeProfiles.requestModel", "one-model");
    await click("claudeProfiles.useOne");
    await click("claudeProfiles.save");
    const roles = mocks.saveProfile.mock.calls[0][0].profile.models.roles;
    for (const role of ["sonnet", "opus", "fable", "haiku", "subagent"])
      expect(roles[role].model).toBe("one-model");
    expect(roles.subagent.displayName).toBe("");
  });
  it("omits unsupported Desktop subagent controls and sends a separate target", async () => {
    await mount("claude_desktop");
    await createAndSave();
    expect(
      container.querySelector(
        'input[aria-label="Subagent claudeProfiles.requestModel"]'
      )
    ).toBeNull();
    expect(mocks.saveProfile.mock.calls[0][0].profile.target).toBe(
      "claude_desktop"
    );
  });
  it("keeps manual model entry usable when discovery fails", async () => {
    mocks.fetchModels.mockRejectedValue(new Error("Discovery unavailable"));
    await mount();
    await click("claudeProfiles.new");
    await click("claudeProfiles.fetchModels");
    expect(container.textContent).toContain("Discovery unavailable");
    await input("Sonnet claudeProfiles.requestModel", "manual/model");
    await click("claudeProfiles.save");
    expect(
      mocks.saveProfile.mock.calls[0][0].profile.models.roles.sonnet.model
    ).toBe("manual/model");
  });
  it("cancels on unmount and ignores late test completion", async () => {
    let complete!: (v: string) => void;
    mocks.test.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        })
    );
    await mount();
    await createAndSave();
    await click("claudeProfiles.test");
    await act(async () => root.render(null));
    expect(mocks.cancelTest).toHaveBeenCalledWith({
      requestId: mocks.test.mock.calls[0][0].requestId,
    });
    await act(async () => complete("late-receipt"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("marks saved updates pending without relabeling the applied revision", async () => {
    const first = {
      ...newProviderProfile("claude_code", "Profile", view),
      revision: 1,
    };
    view.profiles = [{ ...first, revision: 2 }];
    view.appliedProfile = first;
    view.config.mode = "direct";
    await mount();
    expect(container.textContent).toContain("claudeProfiles.updatePending");
  });
  it("copies an existing connection without activating it", async () => {
    view.config.mode = "direct";
    view.config.selectedKeyId = "key";
    view.config.selectedModel = "old-model";
    await mount();
    await click("claudeProfiles.copy");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Sonnet claudeProfiles.requestModel"]'
      )?.value
    ).toBe("old-model");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });
});

it("saves and activates custom Codex models with reasoning and limits without Claude roles", async () => {
  view.config.agentName = "codex";
  view.choices[0].models = [];
  await mount("codex");
  await click("claudeProfiles.new");
  expect(container.textContent).not.toContain("claudeProfiles.mapping");
  await input("codexProfiles.model", "vendor/custom-reasoner");
  await input(
    "harnessConnections.endpoint",
    "https://gateway.example/prefix/v1"
  );
  await input("codexProfiles.contextWindow", "64000");
  await input("codexProfiles.autoCompactTokenLimit", "50000");
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="codexProfiles.reasoning"]'
  )!;
  await act(async () => {
    select.value = "high";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("claudeProfiles.save");
  expect(mocks.saveProfile.mock.calls[0][0].profile).toMatchObject({
    target: "codex",
    authScheme: "bearer",
    endpoint: "https://gateway.example/prefix/v1",
    models: {
      model: "vendor/custom-reasoner",
      reasoningEffort: "high",
      contextWindow: 64000,
      autoCompactTokenLimit: 50000,
    },
  });
  expect(mocks.apply).not.toHaveBeenCalled();
  await click("claudeProfiles.test");
  await click("harnessConnections.apply");
  expect(mocks.apply.mock.calls[0][0]).toMatchObject({
    agentName: "codex",
    model: "vendor/custom-reasoner",
    routing: "direct",
    receipt: "receipt",
  });
  await click("claudeProfiles.test");
  await input("codexProfiles.contextWindow", "65000");
  expect(button("harnessConnections.apply").disabled).toBe(true);
});
it("keeps Codex manual entry available after failed discovery and discards late discovery on cancel", async () => {
  view.config.agentName = "codex";
  await mount("codex");
  await click("claudeProfiles.new");
  mocks.fetchModels.mockRejectedValueOnce(new Error("No model catalog"));
  await click("claudeProfiles.fetchModels");
  expect(container.textContent).toContain("No model catalog");
  await input("codexProfiles.model", "manual/model");
  await click("claudeProfiles.save");
  let complete!: (value: string[]) => void;
  mocks.fetchModels.mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve) => {
        complete = resolve;
      })
  );
  await click("claudeProfiles.fetchModels");
  await click("harnessConnections.cancel");
  await act(async () => complete(["late/model"]));
  expect(container.querySelector('option[value="late/model"]')).toBeNull();
  expect(mocks.cancelTest).toHaveBeenCalled();
});

function profileCard(id: string) {
  const card = container.querySelector<HTMLElement>(
    `[data-testid="provider-profile-${id}"]`
  );
  if (!card) throw new Error(`Missing profile ${id}`);
  return card;
}
function cardButton(id: string, label: string) {
  const element = [...profileCard(id).querySelectorAll("button")].find(
    (b) => b.textContent === label
  );
  if (!element) throw new Error(`Missing ${label} on ${id}`);
  return element;
}
function libraryProfiles(
  target: HarnessProviderProfile["target"] = "claude_code"
) {
  const a = {
    ...newProviderProfile(target, "Production", view),
    id: "production",
    revision: 2,
  };
  const b = {
    ...newProviderProfile(target, "Staging", view),
    id: "staging",
    revision: 3,
    endpoint: "https://staging.example/v1",
  };
  view.config.agentName = target;
  view.profiles = [a, b];
  view.appliedProfile = a;
  view.config.mode = "direct";
  view.config.selectedKeyId = "key";
  return [a, b];
}

it.each(["claude_code", "claude_desktop", "codex"] as const)(
  "duplicates any saved %s profile without writes or inherited activation",
  async (target) => {
    const [, source] = libraryProfiles(target);
    await mount(target);
    await act(async () =>
      cardButton("staging", "providerLibrary.duplicate").click()
    );
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(button("claudeProfiles.save").disabled).toBe(false);
    await click("claudeProfiles.save");
    const copy = mocks.saveProfile.mock.calls[0][0].profile;
    expect(copy.id).not.toBe(source.id);
    expect(copy.revision).toBe(0);
    expect(copy.target).toBe(target);
    expect(copy.models).toEqual(source.models);
    expect(copy.endpoint).toBe(source.endpoint);
    expect(copy.keyId).toBe(source.keyId);
    expect(mocks.apply).not.toHaveBeenCalled();
  }
);

it("tests and applies the selected card without opening the editor or borrowing another receipt", async () => {
  const [production, staging] = libraryProfiles("codex");
  await mount("codex");
  expect(
    container.querySelector('input[aria-label="claudeProfiles.name"]')
  ).toBeNull();
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
  await act(async () => cardButton("staging", "claudeProfiles.test").click());
  expect(mocks.test.mock.calls[0][0].profile).toEqual(staging);
  expect(cardButton("production", "harnessConnections.apply").disabled).toBe(
    true
  );
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(
    false
  );
  await act(async () =>
    cardButton("staging", "harnessConnections.apply").click()
  );
  expect(mocks.apply.mock.calls[0][0]).toMatchObject({
    agentName: "codex",
    profile: staging,
    receipt: "receipt",
    routing: "direct",
  });
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
  expect(view.appliedProfile).toEqual(production); // only a native status refresh can move the active badge
});

it("filters by endpoint and credential while keeping the active connection visible", async () => {
  libraryProfiles();
  await mount();
  await input("providerLibrary.search", "STAGING.EXAMPLE");
  expect(
    container.querySelector('[data-testid="provider-profile-production"]')
  ).toBeNull();
  expect(profileCard("staging")).toBeTruthy();
  expect(
    container.querySelector('[data-testid="provider-active-connection"]')
      ?.textContent
  ).toContain("Production");
  await input("providerLibrary.search", "Gateway");
  expect(profileCard("production")).toBeTruthy();
  await input("providerLibrary.search", "no match");
  expect(container.textContent).toContain("providerLibrary.noResults");
  expect(mocks.test).not.toHaveBeenCalled();
});

it("serializes repeated actions, blocks navigation during a test, and ignores canceled results", async () => {
  libraryProfiles();
  let complete!: (value: string) => void;
  mocks.test.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      })
  );
  const blocked = vi.fn();
  await act(async () =>
    root.render(
      createElement(ProviderProfileEditor, {
        target: "claude_code",
        onAdd: vi.fn(),
        onNavigationBlockedChange: blocked,
      })
    )
  );
  await act(async () => {
    const test = cardButton("staging", "claudeProfiles.test");
    test.click();
    test.click();
  });
  expect(mocks.test).toHaveBeenCalledTimes(1);
  expect(blocked).toHaveBeenLastCalledWith(true);
  expect(cardButton("production", "providerLibrary.duplicate").disabled).toBe(
    true
  );
  await click("harnessConnections.cancel");
  expect(blocked).toHaveBeenLastCalledWith(false);
  await act(async () => complete("late-receipt"));
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
  expect(mocks.cancelTest).toHaveBeenCalledTimes(1);
});

it("keeps editing and duplication available for missing keys but blocks network and activation actions", async () => {
  libraryProfiles();
  view.choices = [];
  await mount();
  expect(cardButton("staging", "providerLibrary.edit").disabled).toBe(false);
  expect(cardButton("staging", "providerLibrary.duplicate").disabled).toBe(
    false
  );
  expect(cardButton("staging", "claudeProfiles.test").disabled).toBe(true);
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
  expect(profileCard("staging").textContent).toContain(
    "harnessConnections.missingKey"
  );
});

it("restores through the existing non-force command and clears test evidence", async () => {
  libraryProfiles();
  mocks.restore.mockResolvedValue(view.config);
  await mount();
  await act(async () => cardButton("staging", "claudeProfiles.test").click());
  await click("harnessConnections.restore");
  expect(mocks.restore).toHaveBeenCalledWith({
    agentName: "claude_code",
    force: false,
  });
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
});

it("surfaces refresh failures and removes activation readiness", async () => {
  libraryProfiles();
  await mount();
  await act(async () => cardButton("staging", "claudeProfiles.test").click());
  mocks.status.mockRejectedValueOnce(
    new Error("Configuration could not be read")
  );
  await click("harnessConnections.refresh");
  expect(container.textContent).toContain("Configuration could not be read");
  expect(cardButton("staging", "harnessConnections.apply").disabled).toBe(true);
});

it("shows read failures without presenting a missing catalog as an empty one", async () => {
  mocks.status.mockRejectedValueOnce(
    new Error("Cannot load provider profiles")
  );
  await mount();
  expect(container.textContent).toContain("Cannot load provider profiles");
  expect(container.textContent).not.toContain("claudeProfiles.empty");
  expect(
    container.querySelector('[data-testid="provider-active-connection"]')
  ).toBeNull();
});
