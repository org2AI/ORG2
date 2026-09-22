/**
 * ChannelFormFields — setup-wizard renderer for the channel field table.
 *
 * Renders a `ChannelField[]` against the wizard's FLAT config store:
 * `config[key]` in, `onChange({ [key]: value })` out. The settings pane uses
 * the same descriptors through its own path-prefixed renderer
 * (`Channels/ChannelConfigFields.tsx`).
 *
 * Replaces the 16 `SetupForms/*Form.tsx` components, which were this same loop
 * written out once per channel.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  SECTION_CONTROL_STYLE,
  SectionRow,
} from "@src/components/layout/Section";
import type { ChannelField } from "@src/modules/MainApp/Integrations/Connections/Channels/fields";

import { getBool, getNumber, getString } from "./types";

/** Text inputs in the wizard suppress browser assistance on every field. */
const TEXT_INPUT_PROPS = {
  autoComplete: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

interface ChannelFormFieldsProps {
  fields: ChannelField[];
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

/**
 * Rows only — the caller owns the `SectionContainer` so a form can interleave
 * rows of its own (the email form's protocol picker).
 */
const ChannelFormFields: React.FC<ChannelFormFieldsProps> = ({
  fields,
  config,
  onChange,
}) => {
  const { t } = useTranslation("integrations");

  return (
    <>
      {fields.map((field) => {
        const placeholder = field.placeholderKey
          ? t(field.placeholderKey)
          : field.placeholder;

        let control: React.ReactNode;
        switch (field.kind) {
          case "bool":
            control = (
              <Switch
                checked={getBool(config, field.key, field.defaultBool ?? false)}
                onCheckedChange={(checked: boolean) =>
                  onChange({ [field.key]: checked })
                }
              />
            );
            break;
          case "select":
            control = (
              <Select
                value={
                  getString(config, field.key) || (field.defaultValue ?? "")
                }
                onChange={(val) => onChange({ [field.key]: val })}
                options={(field.options ?? []).map((option) => ({
                  label: option.labelKey
                    ? t(option.labelKey)
                    : (option.label ?? ""),
                  value: option.value,
                }))}
                style={SECTION_CONTROL_STYLE}
              />
            );
            break;
          case "number": {
            // Commit only values that parse and land inside the bounds; an
            // out-of-range keystroke leaves the stored number untouched.
            const fallback = field.defaultNumber ?? 0;
            control = (
              <Input
                value={String(getNumber(config, field.key, fallback))}
                onChange={(val: string) => {
                  const num = parseInt(val, 10);
                  if (
                    !isNaN(num) &&
                    (field.min === undefined || num >= field.min) &&
                    (field.max === undefined || num <= field.max)
                  )
                    onChange({ [field.key]: num });
                }}
                placeholder={placeholder}
                {...TEXT_INPUT_PROPS}
                style={SECTION_CONTROL_STYLE}
              />
            );
            break;
          }
          default:
            control = (
              <Input
                value={
                  getString(config, field.key) || (field.defaultValue ?? "")
                }
                onChange={(val: string) => onChange({ [field.key]: val })}
                {...(field.kind === "secret"
                  ? { type: "password" as const }
                  : {})}
                placeholder={placeholder}
                {...TEXT_INPUT_PROPS}
                style={SECTION_CONTROL_STYLE}
              />
            );
        }

        return (
          <SectionRow
            key={field.key}
            label={t(field.labelKey)}
            required={field.required}
          >
            {control}
          </SectionRow>
        );
      })}
    </>
  );
};

export default ChannelFormFields;
