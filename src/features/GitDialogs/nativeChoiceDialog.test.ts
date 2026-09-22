/**
 * The native dialog returns the *label text* of the button that was pressed
 * (`MessageDialogResult::Custom` is `#[serde(untagged)]`), so the answer has to
 * be matched against the labels this module built. These tests pin that,
 * including with non-English labels — the previous code compared the answer
 * against English literals, which localizing the buttons would have broken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openNativeChoiceDialog } from "./nativeChoiceDialog";

const { message } = vi.hoisted(() => ({ message: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ message }));
vi.mock("@src/i18n", () => ({
  default: { t: (key: string) => key },
}));

describe("openNativeChoiceDialog", () => {
  beforeEach(() => {
    message.mockReset();
  });

  it("maps one affirmative choice onto ok/cancel buttons", async () => {
    message.mockResolvedValue("Create Pull Request");

    const result = await openNativeChoiceDialog({
      title: "Protected Branch",
      message: "body",
      choices: [{ id: "create_pr", label: "Create Pull Request" }],
    });

    expect(result).toBe("create_pr");
    expect(message).toHaveBeenCalledWith("body", {
      title: "Protected Branch",
      kind: "warning",
      buttons: { ok: "Create Pull Request", cancel: "common:actions.cancel" },
    });
  });

  it("maps two affirmative choices onto yes/no/cancel buttons in order", async () => {
    message.mockResolvedValue("Force Push");

    const result = await openNativeChoiceDialog({
      title: "Push Rejected",
      message: "body",
      kind: "error",
      choices: [
        { id: "pull_push", label: "Pull & Push" },
        { id: "force", label: "Force Push" },
      ],
    });

    expect(result).toBe("force");
    expect(message).toHaveBeenCalledWith("body", {
      title: "Push Rejected",
      kind: "error",
      buttons: {
        yes: "Pull & Push",
        no: "Force Push",
        cancel: "common:actions.cancel",
      },
    });
  });

  it("resolves localized labels — the case the old literal comparison broke", async () => {
    // Git operation names stay English by convention; the prose around them
    // does not. Either way the answer is matched against the built label.
    message.mockResolvedValue("Stash 后 pull");

    const result = await openNativeChoiceDialog({
      title: "无法 pull",
      message: "body",
      choices: [
        { id: "stash_pull", label: "Stash 后 pull" },
        { id: "discard_pull", label: "丢弃后 pull" },
      ],
    });

    expect(result).toBe("stash_pull");
  });

  it("returns cancel for the cancel button and for anything unrecognised", async () => {
    message.mockResolvedValue("Cancel");
    await expect(
      openNativeChoiceDialog({
        title: "t",
        message: "b",
        choices: [{ id: "push", label: "Push All Commits" }],
      })
    ).resolves.toBe("cancel");

    // Dismissed without pressing a button.
    message.mockResolvedValue("");
    await expect(
      openNativeChoiceDialog({
        title: "t",
        message: "b",
        choices: [{ id: "push", label: "Push All Commits" }],
      })
    ).resolves.toBe("cancel");
  });
});
