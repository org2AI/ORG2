export interface RuntimeInstanceProfile {
  instanceId: number;
  ideServerPort: number;
  cliProxyPort: number;
  authDeepLinkScheme: string;
}

const PRIMARY_IDE_SERVER_PORT = 13_847;
const PRIMARY_CLI_PROXY_PORT = 17_888;
const FORK_IDE_SERVER_PORT = 23_847;
const FORK_CLI_PROXY_PORT = 27_888;
const FORK_IDENTIFIER = "com.theerasakping.tpagentstudio";
// Dedicated dev slot, outside the numbered bundle range (2..99).
const DEV_INSTANCE_ID = 100;

/**
 * Resolve the runtime identity embedded by the per-instance Tauri config.
 * Keep these coordinates in parity with `scripts/tauri/instance-profile.cjs`
 * and `src-tauri/src/runtime_instance.rs`.
 */
export function runtimeInstanceProfileForIdentifier(
  identifier: string
): RuntimeInstanceProfile {
  const normalized = identifier.trim();
  // Keep frontend runtime ports and OAuth callback schemes in parity with
  // src-tauri/src/runtime_instance.rs and scripts/tauri/instance-profile.cjs.
  // Unknown fork subidentifiers fail back to the FORK primary identity rather
  // than accidentally selecting the upstream orgii:// / 13xxx endpoints.
  if (
    normalized === FORK_IDENTIFIER ||
    normalized.startsWith(`${FORK_IDENTIFIER}.`)
  ) {
    const forkDev = normalized === `${FORK_IDENTIFIER}.dev`;
    const suffix = normalized.slice(FORK_IDENTIFIER.length);
    const match = /^(?:\.e2e)?\.instance(\d+)$/.exec(suffix);
    const parsedId = match ? Number(match[1]) : 1;
    const instanceId = forkDev
      ? DEV_INSTANCE_ID
      : Number.isInteger(parsedId) && parsedId >= 2 && parsedId <= 99
        ? parsedId
        : 1;
    const authDeepLinkScheme = forkDev
      ? "tpagentstudio-dev"
      : instanceId === 1
        ? "tpagentstudio"
        : `tpagentstudio-instance${instanceId}`;
    return {
      instanceId,
      ideServerPort: FORK_IDE_SERVER_PORT + instanceId - 1,
      cliProxyPort: FORK_CLI_PROXY_PORT + instanceId - 1,
      authDeepLinkScheme,
    };
  }

  if (normalized === "org2ai.org2.dev") {
    return {
      instanceId: DEV_INSTANCE_ID,
      ideServerPort: PRIMARY_IDE_SERVER_PORT + DEV_INSTANCE_ID - 1,
      cliProxyPort: PRIMARY_CLI_PROXY_PORT + DEV_INSTANCE_ID - 1,
      authDeepLinkScheme: "orgii-dev",
    };
  }
  const match = /^org2ai\.org2\.instance(\d+)$/.exec(identifier.trim());
  const parsedId = match ? Number(match[1]) : 1;
  const instanceId =
    Number.isInteger(parsedId) && parsedId >= 2 && parsedId <= 99
      ? parsedId
      : 1;

  return {
    instanceId,
    ideServerPort: PRIMARY_IDE_SERVER_PORT + instanceId - 1,
    cliProxyPort: PRIMARY_CLI_PROXY_PORT + instanceId - 1,
    authDeepLinkScheme:
      instanceId === 1 ? "orgii" : `orgii-instance${instanceId}`,
  };
}
