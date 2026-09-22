import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CliLaunchProfileView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import {
  appendCliCommandArgs,
  cliAgentCreateTuiSession,
  deriveExpectedProcess,
  formatCliTuiCommand,
  resolveCliTuiCommand,
  withCliCommandEnvironment,
} from "../cliTerminalSession";

const { getLaunchProfile, invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getLaunchProfile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    agentOrgs: {
      launchProfiles: {
        get: getLaunchProfile,
      },
    },
  },
}));

function profile(
  overrides: Partial<CliLaunchProfileView> = {}
): CliLaunchProfileView {
  return {
    agentName: "trae_cli",
    permissionMode: "manual",
    defaultCommand: "trae-cli",
    command: "trae-cli",
    args: [],
    env: {},
    manualArgs: [],
    fullPermissionArgs: [],
    manualEnv: {},
    fullPermissionEnv: {},
    supportedPermissionModes: ["manual"],
    modeDefaults: [],
    commandOverridden: false,
    argsOverridden: false,
    envOverridden: false,
    effectiveCommand: ["trae-cli", "interactive"],
    requiredArgs: ["interactive"],
    ...overrides,
  };
}

describe("formatCliTuiCommand", () => {
  it("adds required interactive arguments to the detected executable", () => {
    expect(
      formatCliTuiCommand(profile(), "/opt/trae/bin/trae-cli", false)
    ).toBe("/opt/trae/bin/trae-cli interactive");
  });

  it("omits Codex's prompt-required exec subcommand for interactive TUI launches", () => {
    expect(
      formatCliTuiCommand(
        profile({
          agentName: "codex",
          defaultCommand: "codex",
          command: "codex",
          requiredArgs: ["exec"],
          args: ["--dangerously-bypass-approvals-and-sandbox"],
        }),
        "codex",
        false
      )
    ).toBe("codex --dangerously-bypass-approvals-and-sandbox");
  });

  it("replaces DeepSeek Harness's ACP profile with its TUI profile", () => {
    expect(
      formatCliTuiCommand(
        profile({
          agentName: "deepseek_harness",
          defaultCommand: "dsh",
          command: "dsh",
          requiredArgs: ["--profile", "acp"],
          args: [],
        }),
        "/opt/deepseek/bin/dsh",
        false
      )
    ).toBe("/opt/deepseek/bin/dsh --profile tui");
  });

  it("honors command and argument overrides with POSIX shell-safe quoting", () => {
    expect(
      formatCliTuiCommand(
        profile({
          commandOverridden: true,
          command: "/Applications/Trae Agent/trae-cli",
          requiredArgs: [],
          args: ["interactive", "two words"],
        }),
        "trae-cli",
        false
      )
    ).toBe("'/Applications/Trae Agent/trae-cli' interactive 'two words'");
  });

  it("quotes a backslash-heavy Windows path for PowerShell instead of POSIX-escaping it", () => {
    expect(
      formatCliTuiCommand(
        profile({
          commandOverridden: true,
          command: "C:\\Users\\me\\Trae Agent\\trae-cli.exe",
          requiredArgs: [],
          args: ["interactive"],
        }),
        "trae-cli",
        true
      )
    ).toBe("'C:\\Users\\me\\Trae Agent\\trae-cli.exe' interactive");
  });

  it("doubles embedded single quotes for PowerShell instead of POSIX '\\'' escaping", () => {
    expect(
      formatCliTuiCommand(
        profile({
          commandOverridden: true,
          command: "trae-cli",
          requiredArgs: [],
          args: ["a 'quoted' word"],
        }),
        "trae-cli",
        true
      )
    ).toBe("trae-cli 'a ''quoted'' word'");
  });

  it("passes safe-charset arguments through unquoted on both platforms", () => {
    const withOverride = profile({
      commandOverridden: true,
      command: "/opt/trae/bin/trae-cli",
      requiredArgs: [],
      args: ["interactive"],
    });
    expect(formatCliTuiCommand(withOverride, "trae-cli", false)).toBe(
      "/opt/trae/bin/trae-cli interactive"
    );
    expect(formatCliTuiCommand(withOverride, "trae-cli", true)).toBe(
      "/opt/trae/bin/trae-cli interactive"
    );
  });
});

describe("appendCliCommandArgs", () => {
  it("appends resume arguments after the resolved profile command", () => {
    expect(
      appendCliCommandArgs(
        "claude --permission-mode plan",
        ["--resume", "b52f4220-8b0b-46c5-8ee6-001ebf91c6ed"],
        false
      )
    ).toBe(
      "claude --permission-mode plan --resume b52f4220-8b0b-46c5-8ee6-001ebf91c6ed"
    );
  });

  it("quotes unsafe arguments POSIX-style and drops blank ones", () => {
    expect(
      appendCliCommandArgs("codex", ["resume", " ", "two words"], false)
    ).toBe("codex resume 'two words'");
    expect(appendCliCommandArgs("codex", [], false)).toBe("codex");
  });

  it("quotes a Windows session-file path for PowerShell (backslashes pass through literally)", () => {
    expect(
      appendCliCommandArgs(
        "omp",
        ["--session", "C:\\Users\\me\\.omp\\agent\\sessions\\session.jsonl"],
        true
      )
    ).toBe(
      "omp --session 'C:\\Users\\me\\.omp\\agent\\sessions\\session.jsonl'"
    );
  });

  it("keeps a safe-charset resume id unquoted for PowerShell", () => {
    expect(
      appendCliCommandArgs(
        "claude",
        ["--resume", "b52f4220-8b0b-46c5-8ee6-001ebf91c6ed"],
        true
      )
    ).toBe("claude --resume b52f4220-8b0b-46c5-8ee6-001ebf91c6ed");
  });
});

describe("resolveCliTuiCommand", () => {
  beforeEach(() => {
    getLaunchProfile.mockReset();
  });

  it("falls back to the detected command when the launch-profile RPC rejects", async () => {
    getLaunchProfile.mockRejectedValueOnce(new Error("IPC unavailable"));

    await expect(
      resolveCliTuiCommand("claude_code", "/opt/claude/bin/claude")
    ).resolves.toBe("/opt/claude/bin/claude");
    expect(getLaunchProfile).toHaveBeenCalledWith({ agentName: "claude_code" });
  });

  it("formats the resolved command from a successful profile fetch", async () => {
    getLaunchProfile.mockResolvedValueOnce(
      profile({ requiredArgs: [], args: ["--dangerously-skip-permissions"] })
    );

    await expect(
      resolveCliTuiCommand("trae_cli", "/opt/trae/bin/trae-cli")
    ).resolves.toBe("/opt/trae/bin/trae-cli --dangerously-skip-permissions");
  });
});

describe("deriveExpectedProcess", () => {
  it("returns the first whitespace-delimited token for a plain binary", () => {
    expect(deriveExpectedProcess("claude --resume abc123")).toBe("claude");
  });

  it("unwraps a POSIX-quoted binary containing spaces instead of splitting mid-path", () => {
    expect(
      deriveExpectedProcess("'/Applications/Trae Agent/trae-cli' interactive")
    ).toBe("/Applications/Trae Agent/trae-cli");
  });

  it("unwraps a PowerShell-quoted binary containing spaces", () => {
    expect(
      deriveExpectedProcess(
        "'C:\\Program Files\\Trae\\trae-cli.exe' interactive"
      )
    ).toBe("C:\\Program Files\\Trae\\trae-cli.exe");
  });

  it("returns undefined for a blank command", () => {
    expect(deriveExpectedProcess("   ")).toBeUndefined();
  });
});

describe("launch-scoped environment", () => {
  it("overrides shell startup environment without interpreting directory contents", () => {
    if (process.platform === "win32") return;
    const folder = "/tmp/project's $(echo must-not-expand)";
    const command = withCliCommandEnvironment(
      "sh -c 'printf %s \"$CODEX_HOME\"'",
      { CODEX_HOME: folder },
      false
    );
    expect(
      execFileSync("/bin/sh", ["-c", command], {
        env: { PATH: process.env.PATH, CODEX_HOME: "/wrong/startup/profile" },
      }).toString()
    ).toBe(folder);
  });
  it("quotes Windows directory arguments and rejects environment-name injection", () => {
    expect(
      withCliCommandEnvironment(
        "codex",
        { CODEX_HOME: "C:/my project's" },
        true
      )
    ).toBe("& { $env:CODEX_HOME='C:/my project''s'; & codex }");
    expect(() =>
      withCliCommandEnvironment("codex", { "HOME;echo": "bad" }, true)
    ).toThrow();
  });
});

it.each([
  "C:/profiles/session",
  "123",
  "$env:PATH",
  "$(throw 'unexpected')",
  "",
  "C:/my project's",
])("always emits a PowerShell string literal for %s", (value) => {
  expect(withCliCommandEnvironment("codex", { CODEX_HOME: value }, true)).toBe(
    `& { $env:CODEX_HOME='${value.replace(/'/g, "''")}'; & codex }`
  );
});

const powershellExecutable =
  process.env.ORG2_TEST_PWSH ||
  (process.platform === "win32" ? "powershell.exe" : undefined);
it.skipIf(!powershellExecutable)(
  "executes literal environment assignments in PowerShell and reaches the client body",
  () => {
    for (const folder of [
      "C:/profiles/session",
      "C:/my project's",
      "$(throw 'must-not-run')",
      "$env:PATH",
      "",
    ]) {
      const command = withCliCommandEnvironment(
        "{ [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$env:CODEX_HOME))) }",
        { CODEX_HOME: folder },
        true
      );
      const output = execFileSync(
        powershellExecutable!,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", timeout: 20_000 }
      );
      expect(Buffer.from(output.trim(), "base64").toString("utf8")).toBe(
        folder
      );
    }
  }
);

it("preserves an explicitly selected TUI model in the native create request", async () => {
  invoke.mockResolvedValue({ sessionId: "cli_model" });
  await cliAgentCreateTuiSession({
    platform: "codex",
    name: "Codex",
    model: "gpt-5.3-codex",
    repoPath: "/project",
  });
  expect(invoke).toHaveBeenLastCalledWith("cli_agent_create", {
    params: {
      platform: "codex",
      name: "Codex",
      model: "gpt-5.3-codex",
      repoPath: "/project",
      keySource: "own_key",
      runner: "tui",
    },
  });
  await cliAgentCreateTuiSession({ platform: "codex", name: "Codex" });
  expect(invoke).toHaveBeenLastCalledWith("cli_agent_create", {
    params: {
      platform: "codex",
      name: "Codex",
      keySource: "own_key",
      runner: "tui",
    },
  });
});
