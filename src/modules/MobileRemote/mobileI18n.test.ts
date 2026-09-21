import { describe, expect, it } from "vitest";

import { mobileI18n, mobileI18nReady } from "./mobileI18n";

describe("mobileI18n", () => {
  it("keeps infrastructure jargon out of everyday pairing and task prompts", async () => {
    await mobileI18nReady;
    const keys = [
      "profile.connectionHelp",
      "pairing.scanHint",
      "pairing.urlPlaceholder",
      "pairing.errors.empty",
      "pairing.errors.invalid",
      "pairing.errors.unsupportedVersion",
      "settings.demoBanner",
      "stopConfirm.title",
      "stopConfirm.body",
      "changeReview.partial",
      "changeReview.unavailable",
      "fileViewer.patchFallback",
    ];
    for (const language of ["zh", "en"]) {
      const t = mobileI18n.getFixedT(language, "mobileRemote");
      for (const key of keys) {
        expect(t(key)).not.toBe(key);
        expect(t(key)).not.toMatch(
          /Cloud|Relay|WebSocket|payload|fixtures|snapshot|Agent turn|cancel command|shell|载荷|快照|cancel 指令/i
        );
      }
      expect(t("stopConfirm.body")).toContain(
        language === "zh" ? "可能仍会继续运行" : "may keep running"
      );
    }
  });
  it("uses product-facing account copy without infrastructure branding", async () => {
    await mobileI18nReady;
    for (const language of ["en", "zh"]) {
      const t = mobileI18n.getFixedT(language, "mobileRemote");
      expect(t("auth.title")).toBe(
        language === "zh" ? "登录 ORG2" : "Sign in to ORG2"
      );
      expect(t("auth.subtitle")).toBe(
        language === "zh"
          ? "登录后，连接电脑，随时继续会话"
          : "Connect your computer and pick up your conversations wherever you are"
      );
      for (const key of [
        "auth.title",
        "auth.subtitle",
        "auth.signIn",
        "settings.manageAccount",
        "settings.deleteAccount",
        "profile.deleteHint",
        "profile.pairingStep1",
      ]) {
        expect(t(key)).not.toBe(key);
        expect(t(key)).not.toMatch(/cloud/i);
      }
      expect(t("profile.deleteHint")).toMatch(
        language === "zh" ? /确认/ : /confirm/
      );
    }
  });
  it("ships lifecycle labels, clipboard feedback and bounded-draft errors in both mobile locales", async () => {
    await mobileI18nReady;
    const states = [
      "pending",
      "installing",
      "queued",
      "in_progress",
      "waiting_for_user",
      "waiting_for_funds",
      "paused",
      "completed",
      "failed",
      "error",
      "cancelled",
      "abandoned",
      "timeout",
      "killed",
      "archived",
    ];
    for (const language of ["en", "zh"]) {
      const remote = mobileI18n.getFixedT(language, "mobileRemote");
      for (const state of states) {
        const key = `sessions.state.${state}`;
        expect(remote(key)).not.toBe(key);
        expect(remote(key).length).toBeGreaterThan(0);
      }
      const common = mobileI18n.getFixedT(language, "common");
      expect(common("actions.copy")).toBe(language === "en" ? "Copy" : "复制");
      expect(common("status.copyFailed")).toBe(
        language === "en" ? "Copy failed" : "复制失败"
      );
      expect(common("status.copied")).not.toBe("status.copied");
      expect(common("status.loading")).not.toBe("status.loading");
      const sessions = mobileI18n.getFixedT(language, "sessions");
      expect(sessions("chat.draftTooLong", { max: 100_000 })).toBe(
        language === "en"
          ? "Draft is too long (maximum 100000 characters)"
          : "草稿过长（最多 100000 个字符）"
      );
    }
  });
  it("includes consolidated account and device-status copy in the native bundle", async () => {
    await mobileI18nReady;
    const expected = {
      en: [
        "Help & about",
        "Connection & devices",
        "Current computer",
        "Status unknown",
      ],
      zh: ["帮助与关于", "连接与设备", "当前电脑", "状态未知"],
    };
    const keys = [
      "profile.helpAndAbout",
      "settings.connectionDevices",
      "devices.currentDesktop",
      "devices.presenceUnknown",
    ];
    for (const [language, values] of Object.entries(expected)) {
      const t = mobileI18n.getFixedT(language, "mobileRemote");
      expect(keys.map((key) => t(key))).toEqual(values);
    }
  });
  it("contains the standalone mobile namespaces in English and Chinese", async () => {
    await mobileI18nReady;
    await mobileI18n.changeLanguage("en");
    expect(mobileI18n.t("welcome.title", { ns: "mobileRemote" })).toBe(
      "Mobile Remote"
    );
    expect(mobileI18n.t("composerAccepted", { ns: "mobileRemote" })).toBe(
      "Sent — waiting for the Agent…"
    );
    expect(mobileI18n.t("auth.signIn", { ns: "mobileRemote" })).toBe("Sign in");
    expect(
      mobileI18n.t("settings.permissionFull", { ns: "mobileRemote" })
    ).toBe("Full access");
    expect(mobileI18n.t("chat.allow", { ns: "sessions" })).toBe("Allow");

    await mobileI18n.changeLanguage("zh");
    expect(mobileI18n.t("chat.typeMessage", { ns: "sessions" })).toBe(
      "输入消息…"
    );
    expect(mobileI18n.t("composerAccepted", { ns: "mobileRemote" })).toBe(
      "已发送，正在等待 Agent 回复…"
    );
    expect(mobileI18n.t("auth.signIn", { ns: "mobileRemote" })).toBe("登录");
    expect(
      mobileI18n.t("settings.permissionFull", { ns: "mobileRemote" })
    ).toBe("完整访问");
    expect(mobileI18n.t("devices.currentDesktop", { ns: "mobileRemote" })).toBe(
      "当前电脑"
    );
    expect(mobileI18n.t("actions.close", { ns: "common" })).toBe("关闭");
    expect(mobileI18n.t("rounds.newestFirst", { ns: "mobileRemote" })).toBe(
      "最新优先 ↓"
    );
    expect(mobileI18n.t("actions.back")).toBe("返回");
    expect(mobileI18n.t("actions.search")).toBe("搜索");
    expect(mobileI18n.t("selectors.modelProperties.model")).toBe("模型");
  });

  it("resolves shared desktop component keys via the common default namespace", async () => {
    await mobileI18nReady;
    await mobileI18n.changeLanguage("en");
    expect(mobileI18n.t("actions.back")).toBe("Back");
    expect(mobileI18n.t("actions.search")).toBe("Search");
    expect(mobileI18n.t("selectors.modelProperties.settings")).toBe(
      "Model settings"
    );
    expect(mobileI18n.t("pagination.round", { current: 2 })).toBe("Round 2");
    expect(mobileI18n.t("common:tooltips.startVoiceInput")).toBe(
      "Start voice input"
    );
    expect(
      mobileI18n.t("input.voiceErrorPermissionIosPwa", { ns: "sessions" })
    ).toContain("ORG2 Mobile");
  });

  it("resolves voice permission copy in Chinese", async () => {
    await mobileI18nReady;
    await mobileI18n.changeLanguage("zh");
    expect(
      mobileI18n.t("input.voiceErrorPermissionIosPwa", { ns: "sessions" })
    ).toContain("ORG2 Mobile");
    expect(
      mobileI18n.t("input.voicePermissionSheetTitle", { ns: "sessions" })
    ).toBe("需要麦克风权限");
  });
});
