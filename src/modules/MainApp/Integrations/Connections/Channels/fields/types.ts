/**
 * Channel field descriptors.
 *
 * The 16 channel types used to be described by 32 near-identical components —
 * one `SetupForms/*Form.tsx` per channel for the setup wizard, one
 * `configs/*Config.tsx` per channel for the integrations settings pane. Both
 * were the same `SectionContainer > SectionRow > control` loop; only the field
 * key, label key, placeholder and control kind differed.
 *
 * This module holds that difference as data. Two tables describe the two
 * surfaces (they are NOT the same field list — settings exposes strictly more
 * fields per channel, carries a description per row, and persists list fields
 * as `string[]`), and two thin renderers walk them over a value-accessor
 * adapter:
 *
 *   wizard   — flat store, `config[key]` / `onChange({ key: value })`
 *   settings — nested store, `getNested*(config, "<pathPrefix>.<key>")` /
 *              `update("<pathPrefix>.<key>", value)`
 *
 * Adding a channel is a table row per surface, not two new components.
 */

/**
 * Control to render for a field, and how its value is read and written.
 *
 * - `string`     plain text `Input`
 * - `secret`     text `Input` with `type="password"`
 * - `stringList` comma-separated list. The wizard keeps the raw comma string
 *   (it is posted verbatim); settings persists `string[]` and joins for display.
 * - `bool`       `Switch`
 * - `select`     `Select` over {@link ChannelSelectOption}s
 * - `number`     text `Input` holding a number; writes the parsed int only when
 *   it lands inside [`min`, `max`] (wizard email ports / poll interval)
 * - `port`       `useDraftNumber`-backed text `Input` (settings email ports)
 * - `stepper`    `NumberInput` with sides controls (settings poll interval)
 * - `intString`  text `Input` showing the stored string, writing `parseInt || 0`
 *   (settings MS Teams webhook port)
 */
export type ChannelFieldKind =
  | "string"
  | "secret"
  | "stringList"
  | "bool"
  | "select"
  | "number"
  | "port"
  | "stepper"
  | "intString";

/** One `Select` option. Exactly one of `labelKey` / `label` is set. */
export interface ChannelSelectOption {
  value: string;
  /** i18n key in the `integrations` namespace. */
  labelKey?: string;
  /**
   * Literal label, for the option sets that were never translated in the
   * component this table replaced (Feishu domain / policy / render mode).
   * Preserved verbatim rather than silently promoted to an i18n key.
   */
  label?: string;
}

/** One row of a channel form. */
export interface ChannelField {
  /** Config key, relative to the channel's account object. */
  key: string;
  kind: ChannelFieldKind;
  /** i18n key for the row label, in the `integrations` namespace. */
  labelKey: string;
  /** i18n key for the row description. Settings rows only. */
  descKey?: string;
  /** Literal placeholder text. */
  placeholder?: string;
  /** i18n key for a translated placeholder, when `placeholder` is not literal. */
  placeholderKey?: string;
  /** Wizard rows only — renders the required marker on the row. */
  required?: boolean;
  /** Fallback shown (and, for `emptyAs: "default"`, written) when unset. */
  defaultValue?: string;
  /** Fallback for `bool` fields. */
  defaultBool?: boolean;
  /** Fallback for `number` / `port` / `stepper` fields. */
  defaultNumber?: number;
  /** Options for `select` fields. */
  options?: ChannelSelectOption[];
  /** Bounds for `number` / `port` / `stepper` fields. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * Settings only — what to persist when the input is cleared. `null` removes
   * the key so the backend default applies; `default` rewrites `defaultValue`.
   * Omitted means the empty string is stored as-is.
   */
  emptyAs?: "null" | "default";
}

/**
 * A `SectionContainer` worth of fields. Most channels are a single group;
 * settings email renders three (IMAP / SMTP / behavior).
 */
export interface ChannelFieldGroup {
  /** Stable identity for the React key; not user-visible. */
  id: string;
  fields: ChannelField[];
}
