import { Fragment, type ReactNode, memo } from "react";

import { useShortcutKeys } from "@src/config/keyboard/useShortcutBindings";
import {
  ArrowDown02Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  ArrowUpBigIcon,
  CommandIcon,
  CornerDownLeftIcon,
  Delete01Icon,
  HugeiconsIcon,
  OptionIcon,
  SaturnIcon,
} from "@src/icons";

export const KEYBOARD_SHORTCUT_VARIANT = {
  default: "default",
  dropdown: "dropdown",
  spotlightFooter: "spotlightFooter",
  prominent: "prominent",
  inline: "inline",
} as const;

export type KeyboardShortcutVariant =
  (typeof KEYBOARD_SHORTCUT_VARIANT)[keyof typeof KEYBOARD_SHORTCUT_VARIANT];

export type KeyboardShortcutSize = "default" | "sm" | "lg" | "inline";

export interface KeyboardShortcutProps {
  shortcut?: string;
  shortcutId?: string;
  className?: string;
  variant?: KeyboardShortcutVariant;
  size?: KeyboardShortcutSize;
  rendering?: "native" | "original" | "icons";
}

interface KeyboardShortcutTooltipRow {
  label: ReactNode;
  shortcut?: string;
  shortcutId?: string;
}

interface KeyboardShortcutTooltipContentProps {
  rendering?: KeyboardShortcutProps["rendering"];
  label?: ReactNode;
  shortcutId?: string;
  shortcut?: string;
  rows?: KeyboardShortcutTooltipRow[];
  noShortcut?: boolean;
  className?: string;
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /\bMacintosh\b|\bMac OS X\b/.test(navigator.userAgent);

type ModifierType = "cmd" | "shift" | "option" | "ctrl";
type SpecialKeyType =
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight"
  | "enter"
  | "backspace"
  | "esc"
  | "tab"
  | "space";

type KeyToken =
  | { type: "modifier"; modifier: ModifierType }
  | { type: "special"; special: SpecialKeyType }
  | { type: "key"; label: string };

function normalizeModifier(key: string): ModifierType | null {
  const lower = key.toLowerCase();
  if (
    lower === "cmd" ||
    lower === "command" ||
    lower === "⌘" ||
    lower === "meta"
  ) {
    return "cmd";
  }
  if (lower === "shift" || lower === "⇧") {
    return "shift";
  }
  if (
    lower === "option" ||
    lower === "opt" ||
    lower === "alt" ||
    lower === "⌥"
  ) {
    return "option";
  }
  if (lower === "ctrl" || lower === "control" || lower === "⌃") {
    return "ctrl";
  }
  return null;
}

function normalizeSpecial(key: string): SpecialKeyType | null {
  const lower = key.toLowerCase();
  if (lower === "up" || lower === "arrowup" || lower === "↑") return "arrowUp";
  if (lower === "down" || lower === "arrowdown" || lower === "↓") {
    return "arrowDown";
  }
  if (lower === "left" || lower === "arrowleft" || lower === "←") {
    return "arrowLeft";
  }
  if (lower === "right" || lower === "arrowright" || lower === "→") {
    return "arrowRight";
  }
  if (
    lower === "enter" ||
    lower === "return" ||
    lower === "↵" ||
    lower === "⏎"
  ) {
    return "enter";
  }
  if (lower === "backspace" || lower === "delete" || lower === "⌫") {
    return "backspace";
  }
  if (lower === "esc" || lower === "escape") return "esc";
  if (lower === "tab" || lower === "⇥") return "tab";
  if (lower === "space" || lower === "spacebar") return "space";
  return null;
}

function tokenizePart(part: string): KeyToken {
  const modifier = normalizeModifier(part);
  if (modifier) return { type: "modifier", modifier };
  const special = normalizeSpecial(part);
  if (special) return { type: "special", special };
  return { type: "key", label: part.toUpperCase() };
}

function parseShortcut(shortcut: string): KeyToken[] {
  const tokens: KeyToken[] = [];

  if (shortcut.includes("+")) {
    const parts = shortcut.split("+").map((key) => key.trim());
    let hasQueuedPlusKey = false;

    for (const part of parts) {
      if (part === "") {
        hasQueuedPlusKey = true;
        continue;
      }

      if (hasQueuedPlusKey) {
        tokens.push({ type: "key", label: "+" });
        hasQueuedPlusKey = false;
      }

      tokens.push(tokenizePart(part));
    }

    if (hasQueuedPlusKey) {
      tokens.push({ type: "key", label: "+" });
    }

    return tokens;
  }

  // Whitespace-separated chord, e.g. "esc", "enter", or "up down".
  const trimmed = shortcut.trim();
  const whitespaceParts = trimmed.split(/\s+/).filter(Boolean);
  if (
    whitespaceParts.length > 1 ||
    normalizeModifier(trimmed) ||
    normalizeSpecial(trimmed)
  ) {
    for (const part of whitespaceParts) {
      if (/^[⌃⌥⇧⌘]/.test(part) && part.length > 1)
        tokens.push(...parseShortcut(part));
      else tokens.push(tokenizePart(part));
    }
    return tokens;
  }

  // Packed macOS chords keep each leading modifier as its own token while the
  // remaining key stays whole (`⇧⌘F6` -> `⇧`, `⌘`, `F6`).
  let remaining = trimmed;
  while (/^[⌃⌥⇧⌘]/.test(remaining)) {
    tokens.push(tokenizePart(remaining[0]));
    remaining = remaining.slice(1);
  }
  if (remaining) tokens.push(tokenizePart(remaining));

  return tokens;
}

function ModifierKey({ modifier }: { modifier: ModifierType }) {
  const character = {
    cmd: IS_MAC ? "⌘" : "Meta",
    shift: "⇧",
    option: "⌥",
    ctrl: IS_MAC ? "⌃" : "Ctrl",
  }[modifier];

  return character;
}

function IconModifierKey({
  modifier,
  iconSize,
}: {
  modifier: ModifierType;
  iconSize: number;
}) {
  const icon = {
    cmd: CommandIcon,
    shift: ArrowUpBigIcon,
    option: OptionIcon,
    ctrl: ArrowUp01Icon,
  }[modifier];

  return (
    <HugeiconsIcon
      icon={icon}
      size={iconSize}
      data-icon={
        {
          cmd: "command",
          shift: "arrow-big-up",
          option: "option",
          ctrl: "chevron-up",
        }[modifier]
      }
    />
  );
}

function OriginalSpecialKey({
  special,
  iconSize,
}: {
  special: SpecialKeyType;
  iconSize: number;
}) {
  if (
    special === "arrowUp" ||
    special === "arrowDown" ||
    special === "arrowLeft" ||
    special === "arrowRight"
  ) {
    const icon = {
      arrowUp: ArrowUp02Icon,
      arrowDown: ArrowDown02Icon,
      arrowLeft: ArrowLeft02Icon,
      arrowRight: ArrowRight02Icon,
    }[special];
    const dataIcon = {
      arrowUp: "arrow-up",
      arrowDown: "arrow-down",
      arrowLeft: "arrow-left",
      arrowRight: "arrow-right",
    }[special];
    return (
      <HugeiconsIcon
        icon={icon}
        size={iconSize}
        strokeWidth={2}
        data-icon={dataIcon}
      />
    );
  }

  if (special === "enter") {
    return (
      <HugeiconsIcon
        icon={CornerDownLeftIcon}
        size={iconSize}
        strokeWidth={2}
        data-icon="corner-down-left"
      />
    );
  }

  const character = {
    backspace: "⌫",
    esc: "esc",
    tab: "⇥",
    space: "Space",
  }[special];

  return character;
}

function IconSpecialKey({
  special,
  iconSize,
}: {
  special: SpecialKeyType;
  iconSize: number;
}) {
  if (special === "esc") return "Esc";
  if (special === "tab") return "Tab";
  if (special === "backspace") {
    return (
      <HugeiconsIcon icon={Delete01Icon} data-icon="delete" size={iconSize} />
    );
  }
  if (special === "space") {
    return (
      <HugeiconsIcon icon={SaturnIcon} data-icon="space" size={iconSize} />
    );
  }
  return <OriginalSpecialKey special={special} iconSize={iconSize} />;
}

function SpecialKey({ special }: { special: SpecialKeyType }) {
  const character = {
    arrowUp: "↑",
    arrowDown: "↓",
    arrowLeft: "←",
    arrowRight: "→",
    enter: "↩",
    backspace: "⌫",
    esc: "esc",
    tab: "⇥",
    space: "Space",
  }[special];

  return character;
}

// A shortcut chord is one joined pill, matching the compact presentation used
// by Codex. Individual tokens own their typography and glyph slot; the shared
// `kbd` owns the background, height, padding, and rounded capsule shape.
const KEY_CAP_BASE =
  "inline-flex shrink-0 items-center justify-center rounded-full font-normal leading-none";
const KEY_TOKEN_BASE =
  "inline-flex h-full items-center justify-center align-middle";

const KEY_CAP_SIZES: Record<
  KeyboardShortcutSize,
  {
    cap: string;
    glyph: string;
    glyphSlot: string;
    text: string;
    iconSize: number;
  }
> = {
  default: {
    cap: "h-[18px] pr-1.5 pl-2",
    glyph: "text-[12px]",
    glyphSlot: "w-[13px]",
    text: "text-[11px]",
    iconSize: 13,
  },
  sm: {
    cap: "h-4 pr-1 pl-1.5",
    glyph: "text-[10px]",
    glyphSlot: "w-[11px]",
    text: "text-[9px]",
    iconSize: 11,
  },
  lg: {
    cap: "h-6 pr-2 pl-2.5",
    glyph: "text-[11px]",
    glyphSlot: "w-3.5",
    text: "text-[11px]",
    iconSize: 14,
  },
  inline: {
    cap: "",
    glyph: "text-[11px]",
    glyphSlot: "w-3",
    text: "text-[11px]",
    iconSize: 12,
  },
};

const KEY_CAP_STYLES: Record<
  KeyboardShortcutVariant,
  { kbd: string; cap?: string }
> = {
  default: {
    kbd: "bg-fill-2 text-text-2",
  },
  dropdown: {
    kbd: "bg-fill-2 text-text-2",
  },
  // Used on the Spotlight footer hint strip — the surrounding surface
  // panel is already `fill-2`, so pills bump one shade up to `fill-3` to
  // stay readable against it. Its chips hold one glyph each, so they drop
  // the chord-balancing asymmetric padding for true centering, and grow to
  // 19px so the 13px glyph slot has an even 3px above and below (measured:
  // every chip's ink sits within 0.25px of center on both axes).
  spotlightFooter: {
    kbd: "bg-fill-3 text-text-2",
    cap: "h-[19px] px-[7px]",
  },
  prominent: {
    kbd: "bg-fill-2 font-medium text-text-2",
  },
  inline: {
    kbd: "text-current opacity-70",
  },
};

export const KeyboardShortcut = memo<KeyboardShortcutProps>(
  ({
    shortcut = "",
    shortcutId,
    className = "",
    variant = KEYBOARD_SHORTCUT_VARIANT.default,
    size,
    rendering,
  }) => {
    const resolvedSize =
      size ??
      (variant === KEYBOARD_SHORTCUT_VARIANT.prominent
        ? "lg"
        : variant === KEYBOARD_SHORTCUT_VARIANT.inline
          ? "inline"
          : "default");
    const resolvedRendering =
      rendering ??
      (variant === KEYBOARD_SHORTCUT_VARIANT.prominent ||
      variant === KEYBOARD_SHORTCUT_VARIANT.inline
        ? "icons"
        : variant === KEYBOARD_SHORTCUT_VARIANT.spotlightFooter
          ? "original"
          : "native");
    const resolvedShortcut = useShortcutKeys(shortcutId ?? "");
    const shortcutValue = (shortcutId ? resolvedShortcut : shortcut).trim();
    const alternatives = shortcutValue
      .split(/\s+\/\s+/)
      .filter(Boolean)
      .map(parseShortcut);
    const cap = KEY_CAP_STYLES[variant];
    const capSize = KEY_CAP_SIZES[resolvedSize];

    if (alternatives.length === 0) return null;

    return (
      <div className={`flex items-center ${className}`}>
        {alternatives.map((tokens, alternativeIndex) => {
          const isArrowPair =
            tokens.length === 2 &&
            tokens.every(
              (token) =>
                token.type === "special" &&
                (token.special === "arrowUp" || token.special === "arrowDown")
            );

          return (
            <Fragment key={alternativeIndex}>
              {alternativeIndex > 0 && (
                <span className="mx-1 text-text-4">/</span>
              )}
              <kbd
                className={`${KEY_CAP_BASE} ${cap.cap ?? capSize.cap} ${
                  isArrowPair ? "gap-0" : "gap-0.5"
                } ${cap.kbd}`}
              >
                {tokens.map((token, index) => {
                  const isTextToken =
                    (token.type === "modifier" &&
                      token.modifier === "ctrl" &&
                      !IS_MAC) ||
                    (token.type === "special" &&
                      (token.special === "esc" ||
                        token.special === "tab" ||
                        token.special === "space")) ||
                    (token.type === "key" && token.label.length > 1);
                  const usesGlyphSlot =
                    token.type === "key" &&
                    Array.from(token.label).length === 1;
                  return (
                    <span
                      key={index}
                      style={
                        resolvedRendering === "native"
                          ? {
                              fontFamily:
                                "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                            }
                          : undefined
                      }
                      className={`${KEY_TOKEN_BASE} ${
                        usesGlyphSlot ? capSize.glyphSlot : ""
                      } ${resolvedRendering !== "native" && isTextToken ? capSize.text : capSize.glyph}`}
                    >
                      {token.type === "modifier" &&
                        (resolvedRendering === "icons" ? (
                          <IconModifierKey
                            modifier={token.modifier}
                            iconSize={capSize.iconSize}
                          />
                        ) : (
                          <ModifierKey modifier={token.modifier} />
                        ))}
                      {token.type === "special" &&
                        (resolvedRendering === "icons" ? (
                          <IconSpecialKey
                            special={token.special}
                            iconSize={capSize.iconSize}
                          />
                        ) : resolvedRendering === "original" ? (
                          <OriginalSpecialKey
                            special={token.special}
                            iconSize={capSize.iconSize}
                          />
                        ) : (
                          <SpecialKey special={token.special} />
                        ))}
                      {token.type === "key" && token.label}
                    </span>
                  );
                })}
              </kbd>
            </Fragment>
          );
        })}
      </div>
    );
  }
);

KeyboardShortcut.displayName = "KeyboardShortcut";

export const KeyboardShortcutTooltipContent =
  memo<KeyboardShortcutTooltipContentProps>(
    ({
      label,
      shortcut,
      shortcutId,
      rows,
      noShortcut = false,
      rendering,
      className = "",
    }) => {
      const resolvedShortcut = useShortcutKeys(shortcutId ?? "");
      if (shortcutId) shortcut = resolvedShortcut;
      const resolvedRows =
        rows ?? (label && shortcut && !noShortcut ? [{ label, shortcut }] : []);

      if (resolvedRows.length === 1) {
        const [row] = resolvedRows;
        return (
          <div
            className={`flex max-w-full min-w-0 items-center gap-3 ${className}`}
          >
            <span className="min-w-0 wrap-break-word">{row.label}</span>
            <KeyboardShortcut
              shortcut={row.shortcut}
              shortcutId={row.shortcutId}
              variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
              rendering={rendering}
            />
          </div>
        );
      }

      if (resolvedRows.length > 1) {
        return (
          <div
            className={`flex max-w-full min-w-0 flex-col gap-2 ${className}`}
          >
            {resolvedRows.map((row) => (
              <div
                key={`${row.label}-${row.shortcut}`}
                className="flex min-w-0 items-center justify-between gap-3"
              >
                <span className="min-w-0 wrap-break-word">{row.label}</span>
                <KeyboardShortcut
                  shortcut={row.shortcut}
                  shortcutId={row.shortcutId}
                  variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
                  rendering={rendering}
                />
              </div>
            ))}
          </div>
        );
      }

      if (label) {
        return (
          <span
            className={`inline-block max-w-full wrap-break-word ${className}`}
          >
            {label}
          </span>
        );
      }

      return null;
    }
  );

KeyboardShortcutTooltipContent.displayName = "KeyboardShortcutTooltipContent";

export default KeyboardShortcut;
