import type { MobileConnectionConfig, MobileDesktopIdentity } from "./types";

function label(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (
    !text ||
    Array.from(text).some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return undefined;
  return Array.from(text).slice(0, 128).join("");
}

/** Validate wire and persisted metadata; strip all unrecognized fields. */
export function parseDesktopIdentity(
  value: unknown
): MobileDesktopIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const name = label(input.name);
  const model = label(input.model);
  const username = label(input.username);
  if (!name && !model && !username) return undefined;
  return {
    ...(name && { name }),
    ...(model && { model }),
    ...(username && { username }),
  };
}

export function desktopIdentityName(
  identity: MobileDesktopIdentity | undefined
): string | undefined {
  const valid = parseDesktopIdentity(identity);
  return (
    valid?.name ||
    [valid?.model, valid?.username].filter(Boolean).join(" · ") ||
    undefined
  );
}

export function pairedDesktopId(config: MobileConnectionConfig): string {
  const endpoint =
    config.wsUrl?.trim() ||
    [config.host?.trim(), config.port].filter(Boolean).join(":");
  return config.desktopId?.trim() || `endpoint:${endpoint}`;
}

/** Keep routing credentials/ID unchanged, including LAN endpoint-based pairings. */
export function withInitializedDesktop(
  config: MobileConnectionConfig,
  response: unknown
): MobileConnectionConfig {
  const init =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const identity =
    parseDesktopIdentity(init.desktopIdentity) ??
    parseDesktopIdentity({ name: init.desktopName });
  const previous = parseDesktopIdentity(config.desktopIdentity);
  if (!identity) return config;
  const next = { ...previous, ...identity };
  if (JSON.stringify(next) === JSON.stringify(previous)) return config;
  return { ...config, desktopIdentity: next };
}
