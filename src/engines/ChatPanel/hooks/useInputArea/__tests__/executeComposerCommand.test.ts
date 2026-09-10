import { describe, expect, it, vi } from "vitest";

import { executeComposerCommand } from "../executeComposerCommand";

function actions() {
  return {
    openModel: vi.fn(),
    showStatus: vi.fn(),
    rename: vi.fn().mockResolvedValue(undefined),
    setPlan: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue({ success: true }),
  };
}
describe("native composer controls", () => {
  it("opens the model selector instead of sending a model instruction", async () => {
    const a = actions();
    expect(await executeComposerCommand({ name: "model", args: "" }, a)).toBe(
      ""
    );
    expect(a.openModel).toHaveBeenCalledOnce();
    expect(a.dispatch).not.toHaveBeenCalled();
  });
  it("saves plan mode before returning the planning prompt", async () => {
    const a = actions();
    expect(
      await executeComposerCommand({ name: "plan", args: "Inspect auth" }, a)
    ).toBe("Inspect auth");
    expect(a.setPlan).toHaveBeenCalledOnce();
    a.setPlan.mockRejectedValueOnce(new Error("offline"));
    await expect(
      executeComposerCommand({ name: "plan", args: "Inspect auth" }, a)
    ).rejects.toThrow("offline");
  });
  it("propagates local action failures and rejects silently discarded args", async () => {
    const a = actions();
    await expect(
      executeComposerCommand({ name: "new", args: "lost task" }, a)
    ).rejects.toThrow("without arguments");
    expect(a.dispatch).not.toHaveBeenCalled();
    a.dispatch.mockResolvedValue({ success: false, message: "Unavailable" });
    await expect(
      executeComposerCommand({ name: "resume", args: "" }, a)
    ).rejects.toThrow("Unavailable");
  });
  it("leaves native and custom commands to the provider", async () => {
    const a = actions();
    for (const name of ["compact", "review", "context", "plugin:review"])
      expect(
        await executeComposerCommand({ name, args: "focus" }, a)
      ).toBeUndefined();
    expect(a.dispatch).not.toHaveBeenCalled();
  });
});
