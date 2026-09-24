import { describe, expect, it, vi } from "vitest";

import { saveKey } from "@src/api/services/keyValidation";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

import { toggleModelForAccounts } from "./modelToggle";

vi.mock("@src/api/services/keyValidation", () => ({ saveKey: vi.fn() }));

describe("model enablement write", () => {
  it("changes enablement without replaying a stale available-model catalog", async () => {
    vi.mocked(saveKey).mockResolvedValue({} as never);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const account = {
      id: "account",
      modelType: "custom_api",
      availableModels: ["model-a", "model-b"],
      enabledModels: ["model-a"],
    } as KeyVaultAccount;

    await toggleModelForAccounts(
      "model-a",
      "custom_api",
      false,
      [account],
      refresh
    );

    expect(saveKey).toHaveBeenCalledWith({
      id: "account",
      agent_type: "custom_api",
      enabled_models: [],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
