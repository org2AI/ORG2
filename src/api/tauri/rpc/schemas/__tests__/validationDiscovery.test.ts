import { afterEach, describe, expect, it, vi } from "vitest";

import { rpc } from "../../router";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const agent = {
  name: "codex",
  displayName: "Codex",
  installed: true,
  hasKeys: true,
  installedVia: "homebrew",
  description: "",
  brandColor: "",
  docsUrl: "https://developers.openai.com/codex/cli",
  hasSubscriptionPlan: true,
  nativeSubscriptionLabels: [],
  compatibleApiProviders: [],
  supportedProtocols: [],
  configFiles: [],
  installMethods: [],
  uninstallMethods: [],
  isComplexSetup: false,
  supportedSetupMethods: [],
  popular: true,
  iconProvider: "openai",
  command: "codex",
  supportsRustAgents: true,
  acpSupport: "adapter_backed",
  supportsOrgiiPool: false,
  supportsGui: true,
};

afterEach(() => {
  invokeMock.mockReset();
  vi.unstubAllEnvs();
});

describe.each(["development", "production"])(
  "CLI upgrade discovery in %s",
  (mode) => {
    it("preserves backend upgrade commands through the production RPC decoder", async () => {
      vi.stubEnv("NODE_ENV", mode);
      const payload = {
        ...agent,
        upgradeMethods: [
          {
            id: "npm",
            label: "npm",
            command: "npm install -g @openai/codex@latest",
          },
          {
            id: "homebrew",
            label: "Homebrew",
            command: "brew upgrade --cask codex",
          },
        ],
      };
      invokeMock.mockResolvedValue([payload]);
      await expect(rpc.validation.getAvailableAgents()).resolves.toEqual([
        payload,
      ]);
    });

    it("accepts an older backend without fabricating an upgrade command", async () => {
      vi.stubEnv("NODE_ENV", mode);
      invokeMock.mockResolvedValue([agent]);
      const [decoded] = await rpc.validation.getAvailableAgents();
      expect(decoded.upgradeMethods).toBeUndefined();
      expect(decoded.docsUrl).toBe(agent.docsUrl);
    });
  }
);
