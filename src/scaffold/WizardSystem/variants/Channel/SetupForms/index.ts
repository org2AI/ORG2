/**
 * Channel setup-form surface.
 *
 * The per-channel forms are gone: `ChannelSetupForm` renders the field table
 * in `Channels/fields/wizardFields.ts` instead.
 */
export { default as ChannelSetupForm } from "./ChannelSetupForm";

export function canSubmitChannel(
  channelType: string,
  config: Record<string, unknown>
): boolean {
  const hasValue = (key: string) => {
    const val = config[key];
    return typeof val === "string" && val.trim().length > 0;
  };

  switch (channelType) {
    case "telegram":
      return hasValue("token");
    case "discord":
      return hasValue("token");
    case "whatsapp":
      return true;
    case "feishu":
      return hasValue("appId") && hasValue("appSecret");
    case "dingtalk":
      return hasValue("clientId") && hasValue("clientSecret");
    case "email":
      return hasValue("imapHost") && hasValue("smtpHost");
    case "slack":
      return hasValue("botToken") && hasValue("appToken");
    case "imessage":
      return hasValue("serverUrl") && hasValue("password");
    case "signal":
      return hasValue("phoneNumber");
    case "zalo":
      return hasValue("botToken");
    case "line":
      return hasValue("channelAccessToken") && hasValue("channelSecret");
    case "msteams":
      return hasValue("appId") && hasValue("appPassword");
    case "matrix":
      return (
        hasValue("homeserverUrl") &&
        (hasValue("accessToken") || hasValue("password"))
      );
    case "googlechat":
      return hasValue("serviceAccountKey");
    case "weixin":
      return hasValue("token") && hasValue("botAccountId");
    case "wecom":
      return hasValue("botId") && hasValue("secret");
    default:
      return false;
  }
}
