/**
 * ChannelConfigFields — settings-pane renderer for the channel field table.
 *
 * Walks `CHANNEL_SETTINGS_GROUPS[channelType]` and renders one `SectionRow`
 * per descriptor against the nested config store: values are read with
 * `getNested*(config, "<pathPrefix>.<key>")` and written with
 * `update("<pathPrefix>.<key>", value)`.
 *
 * Replaces the 16 `configs/*Config.tsx` components, which were this same loop
 * written out once per channel.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/components/layout/Section";
import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import { useDraftNumber } from "@src/hooks/ui/useDraftNumber";

import {
  getNestedBool,
  getNestedNumber,
  getNestedString,
  getNestedStringArray,
} from "../../../AgentOrgs/config/osAgent/utils";
import { CHANNEL_SETTINGS_GROUPS, type ChannelField } from "./fields";
import { parseCommaSeparated } from "./utils";

/**
 * Free-typing port input that clamps and commits on blur. A component of its
 * own so `useDraftNumber` runs only for the fields that need it.
 */
const PortControl: React.FC<{
  value: number;
  min?: number;
  max?: number;
  placeholder?: string;
  onCommit: (value: number) => void;
}> = ({ value, min, max, placeholder, onCommit }) => {
  const draft = useDraftNumber({ value, min, max, onChange: onCommit });
  return (
    <Input
      value={draft.displayValue}
      onChange={draft.onInputChange}
      onBlur={draft.onInputBlur}
      style={SECTION_CONTROL_STYLE}
      placeholder={placeholder}
    />
  );
};

interface FieldRowProps {
  field: ChannelField;
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
  pathPrefix: string;
}

const ChannelConfigFieldRow: React.FC<FieldRowProps> = ({
  field,
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");
  const path = `${pathPrefix}.${field.key}`;

  const label = t(field.labelKey);
  const description = field.descKey ? t(field.descKey) : undefined;
  const placeholder = field.placeholderKey
    ? t(field.placeholderKey)
    : field.placeholder;

  const writeText = (val: string) => {
    if (field.emptyAs === "null") update(path, val || null);
    else if (field.emptyAs === "default")
      update(path, val || field.defaultValue);
    else update(path, val);
  };

  const control = (() => {
    switch (field.kind) {
      case "bool":
        return (
          <Switch
            checked={getNestedBool(config, path, field.defaultBool ?? false)}
            onCheckedChange={(checked: boolean) => update(path, checked)}
          />
        );
      case "select":
        return (
          <Select
            value={getNestedString(config, path, field.defaultValue ?? "")}
            onChange={(val) => update(path, val)}
            options={(field.options ?? []).map((option) => ({
              label: option.labelKey
                ? t(option.labelKey)
                : (option.label ?? ""),
              value: option.value,
            }))}
            style={SECTION_CONTROL_STYLE}
          />
        );
      case "stringList":
        return (
          <Input
            value={getNestedStringArray(config, path).join(", ")}
            onChange={(val: string) => update(path, parseCommaSeparated(val))}
            style={SECTION_CONTROL_STYLE}
            placeholder={placeholder}
          />
        );
      case "port":
        return (
          <PortControl
            value={getNestedNumber(config, path, field.defaultNumber ?? 0)}
            min={field.min}
            max={field.max}
            placeholder={placeholder}
            onCommit={(val) => update(path, val)}
          />
        );
      case "stepper":
        return (
          <NumberInput
            value={getNestedNumber(config, path, field.defaultNumber ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            controlsPosition="sides"
            onValueChange={(val) => {
              if (val !== undefined) update(path, val);
            }}
            style={SECTION_CONTROL_STYLE}
          />
        );
      case "intString":
        return (
          <Input
            value={getNestedString(config, path, field.defaultValue ?? "")}
            onChange={(val: string) => update(path, parseInt(val, 10) || 0)}
            style={SECTION_CONTROL_STYLE}
            placeholder={placeholder}
          />
        );
      case "secret":
      case "string":
      default:
        return (
          <Input
            value={getNestedString(config, path, field.defaultValue ?? "")}
            onChange={writeText}
            style={SECTION_CONTROL_STYLE}
            {...(field.kind === "secret" ? { type: "password" as const } : {})}
            placeholder={placeholder}
          />
        );
    }
  })();

  return (
    <SectionRow label={label} description={description}>
      {control}
    </SectionRow>
  );
};

export interface ChannelConfigFieldsProps {
  channelType: string;
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
  /** Config path prefix, e.g. "channels.telegram.accounts.default" */
  pathPrefix: string;
}

const ChannelConfigFields: React.FC<ChannelConfigFieldsProps> = ({
  channelType,
  config,
  update,
  pathPrefix,
}) => {
  const groups = CHANNEL_SETTINGS_GROUPS[channelType];
  if (!groups) return null;

  return (
    <>
      {groups.map((group) => (
        <SectionContainer key={group.id}>
          {group.fields.map((field) => (
            <ChannelConfigFieldRow
              key={field.key}
              field={field}
              config={config}
              update={update}
              pathPrefix={pathPrefix}
            />
          ))}
        </SectionContainer>
      ))}
    </>
  );
};

export default ChannelConfigFields;
