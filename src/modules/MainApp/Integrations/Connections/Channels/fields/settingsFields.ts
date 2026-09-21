/**
 * Channel settings-pane field table (nested config store).
 *
 * Replaces `Integrations/Connections/Channels/configs/*Config.tsx`. Field
 * order, label/description keys, placeholders, password fields, defaults and
 * the empty-value write behaviour are carried over verbatim — a difference
 * here is a user-visible change to the integrations settings pane.
 *
 * This is deliberately NOT the same table as the wizard's: the settings pane
 * exposes strictly more fields per channel (files, policies, webhook paths),
 * carries a `Desc` key on nearly every row, and persists list fields as
 * `string[]` rather than the raw comma string the wizard posts.
 */
import { CHANNEL_DEFAULTS } from "../config";
import { CHANNEL_TYPE } from "../types";
import { EMAIL_SETTINGS_GROUPS } from "./settingsEmailFields";
import type { ChannelField, ChannelFieldGroup } from "./types";

const allowFrom = (placeholder: string): ChannelField => ({
  key: "allowFrom",
  kind: "stringList",
  labelKey: "channels.allowFrom",
  descKey: "channels.allowFromDesc",
  placeholder,
});

/** Wrap a plain field list as the single `SectionContainer` most channels use. */
const oneGroup = (fields: ChannelField[]): ChannelFieldGroup[] => [
  { id: "main", fields },
];

/**
 * Untranslated option labels, kept exactly as the Feishu config component had
 * them. They are literals rather than i18n keys on purpose: promoting them
 * here would change what the pane renders in every non-English locale.
 */
const FEISHU_DOMAIN_OPTIONS = [
  { label: "Feishu (China)", value: "feishu" },
  { label: "Lark (International)", value: "lark" },
];
const FEISHU_DM_POLICY_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Allowlist only", value: "allowlist" },
];
const FEISHU_GROUP_POLICY_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Allowlist only", value: "allowlist" },
  { label: "Disabled", value: "disabled" },
];
const FEISHU_RENDER_MODE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Plain text", value: "raw" },
  { label: "Card", value: "card" },
];

// Spelled out rather than built from a prefix: the i18n key checker credits a
// key only when it sees the whole path as a literal.
const WEIXIN_DM_POLICY_OPTIONS = [
  { value: "open", labelKey: "channels.weixinDmPolicyOpen" },
  { value: "allowlist", labelKey: "channels.weixinDmPolicyAllowlist" },
  { value: "disabled", labelKey: "channels.weixinDmPolicyDisabled" },
];
const WEIXIN_GROUP_POLICY_OPTIONS = [
  { value: "open", labelKey: "channels.weixinGroupPolicyOpen" },
  { value: "allowlist", labelKey: "channels.weixinGroupPolicyAllowlist" },
  { value: "disabled", labelKey: "channels.weixinGroupPolicyDisabled" },
];
const WECOM_DM_POLICY_OPTIONS = [
  { value: "open", labelKey: "channels.wecomDmPolicyOpen" },
  { value: "allowlist", labelKey: "channels.wecomDmPolicyAllowlist" },
  { value: "disabled", labelKey: "channels.wecomDmPolicyDisabled" },
];
const WECOM_GROUP_POLICY_OPTIONS = [
  { value: "open", labelKey: "channels.wecomGroupPolicyOpen" },
  { value: "allowlist", labelKey: "channels.wecomGroupPolicyAllowlist" },
  { value: "disabled", labelKey: "channels.wecomGroupPolicyDisabled" },
];

/** Settings-pane groups per channel type. */
export const CHANNEL_SETTINGS_GROUPS: Record<string, ChannelFieldGroup[]> = {
  [CHANNEL_TYPE.TELEGRAM]: oneGroup([
    {
      key: "token",
      kind: "string",
      labelKey: "channels.telegramToken",
      descKey: "channels.telegramTokenDesc",
      placeholder: "123456:ABC-...",
    },
    {
      key: "proxy",
      kind: "string",
      labelKey: "channels.proxy",
      descKey: "channels.proxyDesc",
      placeholder: "socks5://127.0.0.1:1080",
      emptyAs: "null",
    },
    allowFrom("123456789, 987654321"),
  ]),
  [CHANNEL_TYPE.DISCORD]: oneGroup([
    {
      key: "token",
      kind: "string",
      labelKey: "channels.discordToken",
      descKey: "channels.discordTokenDesc",
      placeholder: "MTk...",
    },
    allowFrom("123456789012345678"),
  ]),
  [CHANNEL_TYPE.SLACK]: oneGroup([
    {
      key: "botToken",
      kind: "string",
      labelKey: "channels.slackBotToken",
      descKey: "channels.slackBotTokenDesc",
      placeholder: "xoxb-...",
    },
    {
      key: "appToken",
      kind: "string",
      labelKey: "channels.slackAppToken",
      descKey: "channels.slackAppTokenDesc",
      placeholder: "xapp-...",
    },
    {
      key: "userToken",
      kind: "string",
      labelKey: "channels.slackUserToken",
      descKey: "channels.slackUserTokenDesc",
      placeholder: "xoxp-...",
    },
    {
      key: "mode",
      kind: "string",
      labelKey: "channels.slackMode",
      descKey: "channels.slackModeDesc",
      placeholder: "socket",
      defaultValue: "socket",
    },
    {
      key: "signingSecret",
      kind: "secret",
      labelKey: "channels.slackSigningSecret",
      descKey: "channels.slackSigningSecretDesc",
      placeholder: "••••••••",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.slackWebhookPath",
      descKey: "channels.slackWebhookPathDesc",
      placeholder: "/slack/events",
      defaultValue: "/slack/events",
    },
    allowFrom("U01ABCDEF, U02GHIJKL"),
  ]),
  [CHANNEL_TYPE.WHATSAPP]: oneGroup([
    {
      key: "bridgeUrl",
      kind: "string",
      labelKey: "channels.whatsappBridge",
      descKey: "channels.whatsappBridgeDesc",
      placeholder: CHANNEL_DEFAULTS.whatsapp.bridgeUrl,
      defaultValue: CHANNEL_DEFAULTS.whatsapp.bridgeUrl,
    },
    allowFrom("+1234567890"),
  ]),
  [CHANNEL_TYPE.IMESSAGE]: oneGroup([
    {
      key: "serverUrl",
      kind: "string",
      labelKey: "channels.imessageServerUrl",
      descKey: "channels.imessageServerUrlDesc",
      placeholder: "http://localhost:1234",
      defaultValue: "http://localhost:1234",
    },
    {
      key: "password",
      kind: "secret",
      labelKey: "channels.imessagePassword",
      descKey: "channels.imessagePasswordDesc",
      placeholder: "••••••••",
    },
    {
      key: "service",
      kind: "string",
      labelKey: "channels.imessageService",
      descKey: "channels.imessageServiceDesc",
      placeholder: "auto",
      defaultValue: "auto",
    },
    {
      key: "region",
      kind: "string",
      labelKey: "channels.imessageRegion",
      descKey: "channels.imessageRegionDesc",
      placeholder: "US",
    },
    allowFrom("+1234567890, user@icloud.com"),
  ]),
  [CHANNEL_TYPE.SIGNAL]: oneGroup([
    {
      key: "phoneNumber",
      kind: "string",
      labelKey: "channels.signalPhoneNumber",
      descKey: "channels.signalPhoneNumberDesc",
      placeholder: "+1234567890",
    },
    {
      key: "apiUrl",
      kind: "string",
      labelKey: "channels.signalApiUrl",
      descKey: "channels.signalApiUrlDesc",
      placeholder: "http://localhost:8080",
      defaultValue: "http://localhost:8080",
    },
    {
      key: "autoStart",
      kind: "bool",
      labelKey: "channels.signalAutoStart",
      descKey: "channels.signalAutoStartDesc",
      defaultBool: false,
    },
    {
      key: "sendReadReceipts",
      kind: "bool",
      labelKey: "channels.signalSendReadReceipts",
      descKey: "channels.signalSendReadReceiptsDesc",
      defaultBool: false,
    },
    allowFrom("+1234567890"),
  ]),
  [CHANNEL_TYPE.FEISHU]: oneGroup([
    {
      key: "domain",
      kind: "select",
      labelKey: "channels.feishuDomain",
      descKey: "channels.feishuDomainDesc",
      defaultValue: "feishu",
      options: FEISHU_DOMAIN_OPTIONS,
    },
    {
      key: "appId",
      kind: "string",
      labelKey: "channels.feishuAppId",
      descKey: "channels.feishuAppIdDesc",
      placeholder: "cli_xxxxxxxx",
    },
    {
      key: "appSecret",
      kind: "secret",
      labelKey: "channels.feishuAppSecret",
      descKey: "channels.feishuAppSecretDesc",
      placeholder: "••••••••",
    },
    {
      key: "encryptKey",
      kind: "secret",
      labelKey: "channels.feishuEncryptKey",
      descKey: "channels.feishuEncryptKeyDesc",
      placeholder: "••••••••",
    },
    {
      key: "dmPolicy",
      kind: "select",
      labelKey: "channels.feishuDmPolicy",
      descKey: "channels.feishuDmPolicyDesc",
      defaultValue: "open",
      options: FEISHU_DM_POLICY_OPTIONS,
    },
    {
      key: "groupPolicy",
      kind: "select",
      labelKey: "channels.feishuGroupPolicy",
      descKey: "channels.feishuGroupPolicyDesc",
      defaultValue: "allowlist",
      options: FEISHU_GROUP_POLICY_OPTIONS,
    },
    {
      key: "requireMention",
      kind: "bool",
      labelKey: "channels.feishuRequireMention",
      descKey: "channels.feishuRequireMentionDesc",
      defaultBool: true,
    },
    {
      key: "renderMode",
      kind: "select",
      labelKey: "channels.feishuRenderMode",
      descKey: "channels.feishuRenderModeDesc",
      defaultValue: "auto",
      options: FEISHU_RENDER_MODE_OPTIONS,
    },
    allowFrom("ou_xxxxxxxx"),
  ]),
  [CHANNEL_TYPE.DINGTALK]: oneGroup([
    {
      key: "clientId",
      kind: "string",
      labelKey: "channels.dingtalkClientId",
      descKey: "channels.dingtalkClientIdDesc",
      placeholder: "dingxxxxxxxx",
    },
    {
      key: "clientSecret",
      kind: "string",
      labelKey: "channels.dingtalkClientSecret",
      descKey: "channels.dingtalkClientSecretDesc",
      placeholder: "******",
    },
    allowFrom("user1, user2"),
  ]),
  [CHANNEL_TYPE.ZALO]: oneGroup([
    {
      key: "botToken",
      kind: "string",
      labelKey: "channels.zaloBotToken",
      descKey: "channels.zaloBotTokenDesc",
      placeholder: "OA token...",
    },
    {
      key: "tokenFile",
      kind: "string",
      labelKey: "channels.zaloTokenFile",
      descKey: "channels.zaloTokenFileDesc",
      placeholder: "/path/to/token.txt",
    },
    {
      key: "webhookUrl",
      kind: "string",
      labelKey: "channels.zaloWebhookUrl",
      descKey: "channels.zaloWebhookUrlDesc",
      placeholder: "https://example.com/webhook/zalo",
    },
    {
      key: "webhookSecret",
      kind: "secret",
      labelKey: "channels.zaloWebhookSecret",
      descKey: "channels.zaloWebhookSecretDesc",
      placeholder: "••••••••",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.zaloWebhookPath",
      descKey: "channels.zaloWebhookPathDesc",
      placeholder: "/zalo/webhook",
    },
    {
      key: "proxy",
      kind: "string",
      labelKey: "channels.zaloProxy",
      descKey: "channels.zaloProxyDesc",
      placeholder: "http://proxy:8080",
    },
    allowFrom("1234567890"),
  ]),
  [CHANNEL_TYPE.LINE]: oneGroup([
    {
      key: "channelAccessToken",
      kind: "string",
      labelKey: "channels.lineChannelAccessToken",
      descKey: "channels.lineChannelAccessTokenDesc",
      placeholderKey: "channels.lineTokenPlaceholder",
    },
    {
      key: "channelSecret",
      kind: "secret",
      labelKey: "channels.lineChannelSecret",
      descKey: "channels.lineChannelSecretDesc",
      placeholder: "••••••••",
    },
    {
      key: "tokenFile",
      kind: "string",
      labelKey: "channels.lineTokenFile",
      descKey: "channels.lineTokenFileDesc",
      placeholder: "/path/to/token.txt",
    },
    {
      key: "secretFile",
      kind: "string",
      labelKey: "channels.lineSecretFile",
      descKey: "channels.lineSecretFileDesc",
      placeholder: "/path/to/secret.txt",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.lineWebhookPath",
      descKey: "channels.lineWebhookPathDesc",
      placeholder: "/line/webhook",
    },
    allowFrom("U1234567890abcdef"),
  ]),
  [CHANNEL_TYPE.MSTEAMS]: oneGroup([
    {
      key: "appId",
      kind: "string",
      labelKey: "channels.msteamsAppId",
      descKey: "channels.msteamsAppIdDesc",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    },
    {
      key: "appPassword",
      kind: "secret",
      labelKey: "channels.msteamsAppPassword",
      descKey: "channels.msteamsAppPasswordDesc",
      placeholder: "••••••••",
    },
    {
      key: "tenantId",
      kind: "string",
      labelKey: "channels.msteamsTenantId",
      descKey: "channels.msteamsTenantIdDesc",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    },
    {
      key: "webhookPort",
      kind: "intString",
      labelKey: "channels.msteamsWebhookPort",
      descKey: "channels.msteamsWebhookPortDesc",
      placeholder: "3978",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.msteamsWebhookPath",
      descKey: "channels.msteamsWebhookPathDesc",
      placeholder: "/api/messages",
    },
    {
      key: "sharePointSiteId",
      kind: "string",
      labelKey: "channels.msteamsSharePointSiteId",
      descKey: "channels.msteamsSharePointSiteIdDesc",
      placeholder: "contoso.sharepoint.com,guid1,guid2",
    },
    allowFrom("user@org.com"),
  ]),
  [CHANNEL_TYPE.MATRIX]: oneGroup([
    {
      key: "homeserverUrl",
      kind: "string",
      labelKey: "channels.matrixHomeserver",
      descKey: "channels.matrixHomeserverDesc",
      placeholder: "https://matrix.org",
      defaultValue: "https://matrix.org",
    },
    {
      key: "userId",
      kind: "string",
      labelKey: "channels.matrixUserId",
      descKey: "channels.matrixUserIdDesc",
      placeholder: "@bot:matrix.org",
    },
    {
      key: "accessToken",
      kind: "secret",
      labelKey: "channels.matrixAccessToken",
      descKey: "channels.matrixAccessTokenDesc",
      placeholder: "••••••••",
    },
    {
      key: "password",
      kind: "secret",
      labelKey: "channels.matrixPassword",
      descKey: "channels.matrixPasswordDesc",
      placeholder: "••••••••",
    },
    {
      key: "deviceName",
      kind: "string",
      labelKey: "channels.matrixDeviceName",
      descKey: "channels.matrixDeviceNameDesc",
      placeholderKey: "channels.matrixDeviceNamePlaceholder",
    },
    {
      key: "encryption",
      kind: "bool",
      labelKey: "channels.matrixEncryption",
      descKey: "channels.matrixEncryptionDesc",
      defaultBool: false,
    },
    {
      key: "autoJoin",
      kind: "string",
      labelKey: "channels.matrixAutoJoin",
      descKey: "channels.matrixAutoJoinDesc",
      placeholder: "allowlist",
      defaultValue: "allowlist",
    },
    allowFrom("@user:matrix.org"),
  ]),
  [CHANNEL_TYPE.GOOGLECHAT]: oneGroup([
    {
      key: "webhookUrl",
      kind: "string",
      labelKey: "channels.googlechatWebhookUrl",
      descKey: "channels.googlechatWebhookUrlDesc",
      placeholder: "https://chat.googleapis.com/v1/spaces/...",
    },
    {
      key: "serviceAccountKey",
      kind: "string",
      labelKey: "channels.googlechatServiceAccountKey",
      descKey: "channels.googlechatServiceAccountKeyDesc",
      placeholder: "/path/to/service-account.json",
    },
    {
      key: "webhookPath",
      kind: "string",
      labelKey: "channels.googlechatWebhookPath",
      descKey: "channels.googlechatWebhookPathDesc",
      placeholder: "/googlechat/webhook",
    },
    {
      key: "audienceType",
      kind: "string",
      labelKey: "channels.googlechatAudienceType",
      descKey: "channels.googlechatAudienceTypeDesc",
      placeholder: "app-url",
    },
    {
      key: "audience",
      kind: "string",
      labelKey: "channels.googlechatAudience",
      descKey: "channels.googlechatAudienceDesc",
      placeholderKey: "channels.googlechatAudiencePlaceholder",
    },
    {
      key: "botUser",
      kind: "string",
      labelKey: "channels.googlechatBotUser",
      descKey: "channels.googlechatBotUserDesc",
      placeholder: "users/123456789",
    },
    allowFrom("user@workspace.com"),
  ]),
  [CHANNEL_TYPE.WEIXIN]: oneGroup([
    {
      key: "token",
      kind: "secret",
      labelKey: "channels.weixinToken",
      descKey: "channels.weixinTokenDesc",
      placeholder: "ilink_bot_token...",
    },
    {
      key: "botAccountId",
      kind: "string",
      labelKey: "channels.weixinBotAccountId",
      descKey: "channels.weixinBotAccountIdDesc",
      placeholder: "wxid_xxxxxxxx",
    },
    {
      key: "baseUrl",
      kind: "string",
      labelKey: "channels.weixinBaseUrl",
      descKey: "channels.weixinBaseUrlDesc",
      placeholder: CHANNEL_DEFAULTS.weixin.baseUrl,
      defaultValue: CHANNEL_DEFAULTS.weixin.baseUrl,
      emptyAs: "default",
    },
    {
      key: "dmPolicy",
      kind: "select",
      labelKey: "channels.weixinDmPolicy",
      descKey: "channels.weixinDmPolicyDesc",
      defaultValue: CHANNEL_DEFAULTS.weixin.dmPolicy,
      options: WEIXIN_DM_POLICY_OPTIONS,
    },
    allowFrom("wxid_aaa, wxid_bbb"),
    {
      key: "groupPolicy",
      kind: "select",
      labelKey: "channels.weixinGroupPolicy",
      descKey: "channels.weixinGroupPolicyDesc",
      defaultValue: CHANNEL_DEFAULTS.weixin.groupPolicy,
      options: WEIXIN_GROUP_POLICY_OPTIONS,
    },
    {
      key: "groupAllowFrom",
      kind: "stringList",
      labelKey: "channels.weixinGroupAllowFrom",
      descKey: "channels.weixinGroupAllowFromDesc",
      placeholder: "room_id_1, room_id_2",
    },
  ]),
  [CHANNEL_TYPE.WECOM]: oneGroup([
    {
      key: "botId",
      kind: "string",
      labelKey: "channels.wecomBotId",
      descKey: "channels.wecomBotIdDesc",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    },
    {
      key: "secret",
      kind: "secret",
      labelKey: "channels.wecomSecret",
      descKey: "channels.wecomSecretDesc",
      placeholder: "secret...",
    },
    {
      key: "websocketUrl",
      kind: "string",
      labelKey: "channels.wecomWebsocketUrl",
      descKey: "channels.wecomWebsocketUrlDesc",
      placeholder: CHANNEL_DEFAULTS.wecom.websocketUrl,
      defaultValue: CHANNEL_DEFAULTS.wecom.websocketUrl,
      emptyAs: "null",
    },
    {
      key: "dmPolicy",
      kind: "select",
      labelKey: "channels.wecomDmPolicy",
      descKey: "channels.wecomDmPolicyDesc",
      defaultValue: CHANNEL_DEFAULTS.wecom.dmPolicy,
      options: WECOM_DM_POLICY_OPTIONS,
    },
    allowFrom("@userid1, @userid2"),
    {
      key: "groupPolicy",
      kind: "select",
      labelKey: "channels.wecomGroupPolicy",
      descKey: "channels.wecomGroupPolicyDesc",
      defaultValue: CHANNEL_DEFAULTS.wecom.groupPolicy,
      options: WECOM_GROUP_POLICY_OPTIONS,
    },
    {
      key: "groupAllowFrom",
      kind: "stringList",
      labelKey: "channels.wecomGroupAllowFrom",
      descKey: "channels.wecomGroupAllowFromDesc",
      placeholder: "group_id_1, group_id_2",
    },
  ]),
  [CHANNEL_TYPE.EMAIL]: EMAIL_SETTINGS_GROUPS,
};
