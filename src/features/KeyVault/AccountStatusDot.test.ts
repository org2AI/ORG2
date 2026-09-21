import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { AccountStatus } from "@src/hooks/keyVault/types";

import { AccountStatusDot } from "./AccountStatusDot";

const tooltipContent = vi.hoisted(() => ({ last: "" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string): string => key }),
}));

vi.mock("@src/components/Tooltip", async () => {
  const { createElement: create, Fragment } = await import("react");
  const { renderToStaticMarkup: toMarkup } = await import("react-dom/server");
  return {
    default: ({
      content,
      children,
    }: {
      content: React.ReactNode;
      children: React.ReactNode;
    }) => {
      tooltipContent.last = toMarkup(create(Fragment, null, content));
      return children;
    },
  };
});

function account(
  status: AccountStatus,
  lastFailureMessage?: string
): KeyVaultAccount {
  return {
    id: "account",
    hasLocalKey: true,
    isListed: false,
    modelType: "deepseek_api",
    name: "DeepSeek",
    status,
    hasKey: true,
    hasApiKey: true,
    hasSessionToken: false,
    enabled: true,
    lastFailureMessage,
  };
}

function render(target: KeyVaultAccount): string {
  return renderToStaticMarkup(
    createElement(AccountStatusDot, { account: target })
  );
}

describe("AccountStatusDot", () => {
  it("renders nothing for a usable key", () => {
    expect(render(account("ready", "refresh_token_invalidated"))).toBe("");
  });

  it("shows a danger dot whose tooltip names the status and last failure", () => {
    const markup = render(account("error", "refresh_token_invalidated"));

    expect(markup).toContain("bg-danger-6");
    expect(markup).toContain('aria-label="status.error"');
    expect(tooltipContent.last).toContain("status.error");
    expect(tooltipContent.last).toContain("refresh_token_invalidated");
  });

  it("shows a warning dot for keys that still need setup", () => {
    const markup = render(account("needs_setup"));

    expect(markup).toContain("bg-warning-6");
    expect(tooltipContent.last).toContain("status.needsSetup");
  });
});
