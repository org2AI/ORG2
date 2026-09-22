/**
 * ChannelSetupForm — the setup wizard's per-channel form.
 *
 * Every channel but email is its row list from `CHANNEL_WIZARD_FIELDS`
 * rendered by `ChannelFormFields`. Email keeps a component of its own because
 * it is not a flat row list: a `SelectionGrid` picks IMAP or SMTP and only
 * that protocol's rows render.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { SectionContainer, SectionRow } from "@src/components/layout/Section";
import { Mail01Icon, MailSend01Icon } from "@src/icons";
import {
  CHANNEL_WIZARD_FIELDS,
  EMAIL_WIZARD_GROUPS,
} from "@src/modules/MainApp/Integrations/Connections/Channels/fields";
import { CHANNEL_TYPE } from "@src/modules/MainApp/Integrations/Connections/Channels/types";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import ChannelFormFields from "./ChannelFormFields";
import type { ChannelFormProps } from "./types";

const EMAIL_METHODS: SelectionGridOption[] = [
  { key: "imap", label: "IMAP", icon: Mail01Icon },
  { key: "smtp", label: "SMTP", icon: MailSend01Icon },
];

const EmailSetupForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  const [method, setMethod] = useState<"imap" | "smtp">("imap");

  return (
    <SectionContainer>
      <SectionRow label={t("channels.emailProtocol")} layout="vertical">
        <SelectionGrid
          options={EMAIL_METHODS}
          selected={method}
          cardVariant="subtle"
          onSelect={(key) => setMethod(key as "imap" | "smtp")}
        />
      </SectionRow>
      <ChannelFormFields
        fields={EMAIL_WIZARD_GROUPS[method]}
        config={config}
        onChange={onChange}
      />
    </SectionContainer>
  );
};

interface ChannelSetupFormProps extends ChannelFormProps {
  channelType: string;
}

const ChannelSetupForm: React.FC<ChannelSetupFormProps> = ({
  channelType,
  config,
  onChange,
}) => {
  if (channelType === CHANNEL_TYPE.EMAIL)
    return <EmailSetupForm config={config} onChange={onChange} />;

  const fields = CHANNEL_WIZARD_FIELDS[channelType];
  if (!fields) return null;

  return (
    <SectionContainer>
      <ChannelFormFields fields={fields} config={config} onChange={onChange} />
    </SectionContainer>
  );
};

export default ChannelSetupForm;
