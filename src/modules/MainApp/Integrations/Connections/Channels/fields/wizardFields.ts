/**
 * Channel setup-wizard field table (flat config store).
 *
 * Replaces `scaffold/WizardSystem/variants/Channel/SetupForms/*Form.tsx`.
 * Field order, label keys, placeholders, `required` markers and password
 * fields are carried over verbatim from those components — a difference here
 * is a user-visible change to the setup wizard.
 *
 * The wizard persists `allowFrom` as the raw comma-separated string the user
 * typed; only the settings pane splits it into `string[]`. `stringList` here
 * therefore renders and writes a plain string.
 */
import { CHANNEL_DEFAULTS } from "../config";
import { CHANNEL_TYPE } from "../types";
import type { ChannelField } from "./types";

const allowFrom = (placeholder: string): ChannelField => ({
  key: "allowFrom",
  kind: "stringList",
  labelKey: "channels.allowFrom",
  placeholder,
});

const EMAIL_DEFAULTS = CHANNEL_DEFAULTS.email;

/**
 * Wizard rows per channel type. Email is absent: its form picks IMAP or SMTP
 * with a `SelectionGrid` before rendering rows, so it uses
 * {@link EMAIL_WIZARD_GROUPS} instead.
 */
export const CHANNEL_WIZARD_FIELDS: Record<string, ChannelField[]> = {
  [CHANNEL_TYPE.TELEGRAM]: [
    {
      key: "token",
      kind: "string",
      labelKey: "channels.telegramToken",
      placeholder: "123456:ABC-...",
      required: true,
    },
    {
      key: "proxy",
      kind: "string",
      labelKey: "channels.proxy",
      placeholder: "socks5://127.0.0.1:1080",
    },
    allowFrom("123456789, 987654321"),
  ],
  [CHANNEL_TYPE.DISCORD]: [
    {
      key: "token",
      kind: "string",
      labelKey: "channels.discordToken",
      placeholder: "MTk...",
      required: true,
    },
    allowFrom("123456789012345678"),
  ],
  [CHANNEL_TYPE.SLACK]: [
    {
      key: "botToken",
      kind: "string",
      labelKey: "channels.slackBotToken",
      placeholder: "xoxb-...",
      required: true,
    },
    {
      key: "appToken",
      kind: "string",
      labelKey: "channels.slackAppToken",
      placeholder: "xapp-...",
      required: true,
    },
    {
      key: "userToken",
      kind: "string",
      labelKey: "channels.slackUserToken",
      placeholder: "xoxp-...",
    },
    allowFrom("U01ABCDEF, U02GHIJKL"),
  ],
  [CHANNEL_TYPE.WHATSAPP]: [
    {
      key: "bridgeUrl",
      kind: "string",
      labelKey: "channels.whatsappBridge",
      placeholder: CHANNEL_DEFAULTS.whatsapp.bridgeUrl,
      defaultValue: CHANNEL_DEFAULTS.whatsapp.bridgeUrl,
    },
    allowFrom("+1234567890"),
  ],
  [CHANNEL_TYPE.IMESSAGE]: [
    {
      key: "serverUrl",
      kind: "string",
      labelKey: "channels.imessageServerUrl",
      placeholder: "http://localhost:1234",
      required: true,
    },
    {
      key: "password",
      kind: "secret",
      labelKey: "channels.imessagePassword",
      placeholder: "••••••••",
      required: true,
    },
    {
      key: "service",
      kind: "string",
      labelKey: "channels.imessageService",
      placeholder: "auto",
    },
    allowFrom("+1234567890, user@icloud.com"),
  ],
  [CHANNEL_TYPE.SIGNAL]: [
    {
      key: "phoneNumber",
      kind: "string",
      labelKey: "channels.signalPhoneNumber",
      placeholder: "+1234567890",
      required: true,
    },
    {
      key: "apiUrl",
      kind: "string",
      labelKey: "channels.signalApiUrl",
      placeholder: "http://localhost:8080",
    },
    allowFrom("+1234567890"),
  ],
  [CHANNEL_TYPE.FEISHU]: [
    {
      key: "appId",
      kind: "string",
      labelKey: "channels.feishuAppId",
      placeholder: "cli_...",
      required: true,
    },
    {
      key: "appSecret",
      kind: "string",
      labelKey: "channels.feishuAppSecret",
      placeholder: "******",
      required: true,
    },
    {
      key: "encryptKey",
      kind: "string",
      labelKey: "channels.feishuEncryptKey",
      placeholder: "******",
    },
    allowFrom("ou_xxxxxxxx"),
  ],
  [CHANNEL_TYPE.DINGTALK]: [
    {
      key: "clientId",
      kind: "string",
      labelKey: "channels.dingtalkClientId",
      placeholder: "dingxxxxxxxx",
      required: true,
    },
    {
      key: "clientSecret",
      kind: "string",
      labelKey: "channels.dingtalkClientSecret",
      placeholder: "******",
      required: true,
    },
    allowFrom("user1, user2"),
  ],
  [CHANNEL_TYPE.ZALO]: [
    {
      key: "botToken",
      kind: "string",
      labelKey: "channels.zaloBotToken",
      placeholder: "OA token...",
      required: true,
    },
    {
      key: "webhookUrl",
      kind: "string",
      labelKey: "channels.zaloWebhookUrl",
      placeholder: "https://example.com/webhook/zalo",
    },
    {
      key: "webhookSecret",
      kind: "secret",
      labelKey: "channels.zaloWebhookSecret",
      placeholder: "••••••••",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.zaloWebhookPath",
      placeholder: "/zalo/webhook",
    },
    allowFrom("1234567890"),
  ],
  [CHANNEL_TYPE.LINE]: [
    {
      key: "channelAccessToken",
      kind: "string",
      labelKey: "channels.lineChannelAccessToken",
      placeholder: "Channel access token...",
      required: true,
    },
    {
      key: "channelSecret",
      kind: "secret",
      labelKey: "channels.lineChannelSecret",
      placeholder: "••••••••",
      required: true,
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.lineWebhookPath",
      placeholder: "/line/webhook",
    },
    allowFrom("U1234567890abcdef"),
  ],
  [CHANNEL_TYPE.MSTEAMS]: [
    {
      key: "appId",
      kind: "string",
      labelKey: "channels.msteamsAppId",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      required: true,
    },
    {
      key: "appPassword",
      kind: "secret",
      labelKey: "channels.msteamsAppPassword",
      placeholder: "••••••••",
      required: true,
    },
    {
      key: "tenantId",
      kind: "string",
      labelKey: "channels.msteamsTenantId",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    },
    {
      key: "webhookPort",
      kind: "string",
      labelKey: "channels.msteamsWebhookPort",
      placeholder: "3978",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.msteamsWebhookPath",
      placeholder: "/api/messages",
    },
    allowFrom("user@org.com"),
  ],
  [CHANNEL_TYPE.MATRIX]: [
    {
      key: "homeserverUrl",
      kind: "string",
      labelKey: "channels.matrixHomeserver",
      placeholder: "https://matrix.org",
      required: true,
    },
    {
      key: "userId",
      kind: "string",
      labelKey: "channels.matrixUserId",
      placeholder: "@bot:matrix.org",
    },
    {
      key: "accessToken",
      kind: "secret",
      labelKey: "channels.matrixAccessToken",
      placeholder: "••••••••",
    },
    {
      key: "password",
      kind: "secret",
      labelKey: "channels.matrixPassword",
      placeholder: "••••••••",
    },
    allowFrom("@user:matrix.org"),
  ],
  [CHANNEL_TYPE.GOOGLECHAT]: [
    {
      key: "serviceAccountKey",
      kind: "string",
      labelKey: "channels.googlechatServiceAccountKey",
      placeholder: "/path/to/service-account.json",
      required: true,
    },
    {
      key: "webhookUrl",
      kind: "string",
      labelKey: "channels.googlechatWebhookUrl",
      placeholder: "https://chat.googleapis.com/v1/spaces/...",
    },
    {
      key: "botUser",
      kind: "string",
      labelKey: "channels.googlechatBotUser",
      placeholder: "users/123456789",
    },
    allowFrom("user@workspace.com"),
  ],
  [CHANNEL_TYPE.WEIXIN]: [
    {
      key: "token",
      kind: "secret",
      labelKey: "channels.weixinToken",
      placeholder: "ilink_bot_token...",
      required: true,
    },
    {
      key: "botAccountId",
      kind: "string",
      labelKey: "channels.weixinBotAccountId",
      placeholder: "wxid_xxxxxxxx",
      required: true,
    },
    {
      key: "baseUrl",
      kind: "string",
      labelKey: "channels.weixinBaseUrl",
      placeholder: CHANNEL_DEFAULTS.weixin.baseUrl,
      defaultValue: CHANNEL_DEFAULTS.weixin.baseUrl,
    },
    {
      key: "dmPolicy",
      kind: "select",
      labelKey: "channels.weixinDmPolicy",
      defaultValue: CHANNEL_DEFAULTS.weixin.dmPolicy,
      options: [
        { value: "open", labelKey: "channels.weixinDmPolicyOpen" },
        { value: "allowlist", labelKey: "channels.weixinDmPolicyAllowlist" },
        { value: "disabled", labelKey: "channels.weixinDmPolicyDisabled" },
      ],
    },
    allowFrom("wxid_aaa, wxid_bbb"),
  ],
  [CHANNEL_TYPE.WECOM]: [
    {
      key: "botId",
      kind: "string",
      labelKey: "channels.wecomBotId",
      placeholder: "wb_xxxxxxxx",
      required: true,
    },
    {
      key: "secret",
      kind: "secret",
      labelKey: "channels.wecomSecret",
      placeholder: "••••••••",
      required: true,
    },
    {
      key: "websocketUrl",
      kind: "string",
      labelKey: "channels.wecomWebsocketUrl",
      placeholder: CHANNEL_DEFAULTS.wecom.websocketUrl,
      defaultValue: CHANNEL_DEFAULTS.wecom.websocketUrl,
    },
    {
      key: "dmPolicy",
      kind: "select",
      labelKey: "channels.wecomDmPolicy",
      defaultValue: CHANNEL_DEFAULTS.wecom.dmPolicy,
      options: [
        { value: "open", labelKey: "channels.wecomDmPolicyOpen" },
        { value: "allowlist", labelKey: "channels.wecomDmPolicyAllowlist" },
        { value: "disabled", labelKey: "channels.wecomDmPolicyDisabled" },
      ],
    },
    allowFrom("user1, user2"),
  ],
};

/**
 * Email is the one wizard form that is not a flat row list: a `SelectionGrid`
 * picks IMAP or SMTP and only that protocol's rows render.
 */
export const EMAIL_WIZARD_GROUPS: Record<"imap" | "smtp", ChannelField[]> = {
  imap: [
    {
      key: "imapHost",
      kind: "string",
      labelKey: "channels.emailImapHost",
      placeholder: "imap.gmail.com",
      required: true,
    },
    {
      key: "imapPort",
      kind: "number",
      labelKey: "channels.emailImapPort",
      placeholder: String(EMAIL_DEFAULTS.imapPort),
      defaultNumber: EMAIL_DEFAULTS.imapPort,
      min: 1,
      max: 65535,
    },
    {
      key: "imapUsername",
      kind: "string",
      labelKey: "channels.emailUsername",
      placeholder: "user@gmail.com",
    },
    {
      key: "imapPassword",
      kind: "secret",
      labelKey: "channels.emailPassword",
      placeholder: "******",
    },
    {
      key: "imapMailbox",
      kind: "string",
      labelKey: "channels.emailMailbox",
      placeholder: EMAIL_DEFAULTS.imapMailbox,
      defaultValue: EMAIL_DEFAULTS.imapMailbox,
    },
    {
      key: "imapUseSsl",
      kind: "bool",
      labelKey: "channels.emailImapSsl",
      defaultBool: EMAIL_DEFAULTS.imapUseSsl,
    },
  ],
  smtp: [
    {
      key: "smtpHost",
      kind: "string",
      labelKey: "channels.emailSmtpHost",
      placeholder: "smtp.gmail.com",
      required: true,
    },
    {
      key: "smtpPort",
      kind: "number",
      labelKey: "channels.emailSmtpPort",
      placeholder: String(EMAIL_DEFAULTS.smtpPort),
      defaultNumber: EMAIL_DEFAULTS.smtpPort,
      min: 1,
      max: 65535,
    },
    {
      key: "smtpUsername",
      kind: "string",
      labelKey: "channels.emailUsername",
      placeholder: "user@gmail.com",
    },
    {
      key: "smtpPassword",
      kind: "secret",
      labelKey: "channels.emailPassword",
      placeholder: "******",
    },
    {
      key: "smtpUseTls",
      kind: "bool",
      labelKey: "channels.emailSmtpTls",
      defaultBool: EMAIL_DEFAULTS.smtpUseTls,
    },
    {
      key: "fromAddress",
      kind: "string",
      labelKey: "channels.emailFromAddress",
      placeholder: "agent@example.com",
      required: true,
    },
    {
      key: "autoReplyEnabled",
      kind: "bool",
      labelKey: "channels.emailAutoReply",
      defaultBool: EMAIL_DEFAULTS.autoReplyEnabled,
    },
    {
      key: "pollIntervalSeconds",
      kind: "number",
      labelKey: "channels.emailPollInterval",
      placeholder: String(EMAIL_DEFAULTS.pollIntervalSeconds),
      defaultNumber: EMAIL_DEFAULTS.pollIntervalSeconds,
      min: 5,
      max: 3600,
    },
    allowFrom("user@example.com"),
  ],
};
