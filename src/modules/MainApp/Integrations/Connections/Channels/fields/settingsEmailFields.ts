/**
 * Settings-pane field groups for the email channel.
 *
 * Split out of `settingsFields.ts` only to keep that file under the repo's
 * 700-line ceiling; email is the one channel that renders three
 * `SectionContainer`s (IMAP / SMTP / behavior) instead of one.
 */
import { CHANNEL_DEFAULTS } from "../config";
import type { ChannelField, ChannelFieldGroup } from "./types";

const EMAIL_DEFAULTS = CHANNEL_DEFAULTS.email;

const allowFrom = (placeholder: string): ChannelField => ({
  key: "allowFrom",
  kind: "stringList",
  labelKey: "channels.allowFrom",
  descKey: "channels.allowFromDesc",
  placeholder,
});

export const EMAIL_SETTINGS_GROUPS: ChannelFieldGroup[] = [
  {
    id: "imap",
    fields: [
      {
        key: "imapHost",
        kind: "string",
        labelKey: "channels.emailImapHost",
        descKey: "channels.emailImapHostDesc",
        placeholder: "imap.gmail.com",
      },
      {
        key: "imapPort",
        kind: "port",
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
  },
  {
    id: "smtp",
    fields: [
      {
        key: "smtpHost",
        kind: "string",
        labelKey: "channels.emailSmtpHost",
        descKey: "channels.emailSmtpHostDesc",
        placeholder: "smtp.gmail.com",
      },
      {
        key: "smtpPort",
        kind: "port",
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
    ],
  },
  {
    id: "behavior",
    fields: [
      {
        key: "fromAddress",
        kind: "string",
        labelKey: "channels.emailFromAddress",
        descKey: "channels.emailFromAddressDesc",
        placeholder: "agent@example.com",
      },
      {
        key: "autoReplyEnabled",
        kind: "bool",
        labelKey: "channels.emailAutoReply",
        descKey: "channels.emailAutoReplyDesc",
        defaultBool: EMAIL_DEFAULTS.autoReplyEnabled,
      },
      {
        key: "pollIntervalSeconds",
        kind: "stepper",
        labelKey: "channels.emailPollInterval",
        descKey: "channels.emailPollIntervalDesc",
        defaultNumber: EMAIL_DEFAULTS.pollIntervalSeconds,
        min: 5,
        max: 3600,
        step: 5,
      },
      allowFrom("user@example.com"),
    ],
  },
];
