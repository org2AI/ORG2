import tailwindcss from "@tailwindcss/postcss";
import type { TFunction } from "i18next";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import postcss from "postcss";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeXmlIcon } from "@src/icons";

import { SessionInfoPillGroup } from "../SessionInfoLine/SessionInfoPillGroup";
import { buildSessionInfoSegments } from "../SessionInfoLine/buildSessionInfoSegments";

const longBranch =
  "dev/long-branch-name-that-should-fill-remaining-width-and-then-ellipsize";
const scenarios = [
  { name: "narrow", width: 320 },
  { name: "medium", width: 600 },
  { name: "wide", width: 900 },
  {
    name: "long-source",
    width: 320,
    source: "A very long repository name".repeat(4),
  },
  { name: "loading", width: 320, loading: true },
  { name: "no-branch", width: 320, hideBranch: true },
  { name: "disabled", width: 320, disabled: true },
];

function renderRow(scenario: (typeof scenarios)[number]): string {
  const segments = buildSessionInfoSegments({
    SourceIcon: CodeXmlIcon,
    hasSource: true,
    sourceDisplayName: scenario.source ?? "project-name",
    showBranchRow: !scenario.hideBranch,
    isRepoSelectorOpen: false,
    isBranchSelectorOpen: false,
    branchName: longBranch,
    branchLoading: scenario.loading,
    worktreeLocation: "local",
    isLocationDropdownOpen: false,
    locationTriggerRef: React.createRef<HTMLButtonElement>(),
    disabled: scenario.disabled ?? false,
    t: ((key: string) =>
      key === "status.loading" ? "Loading" : "This Mac") as TFunction,
    handleRepoTriggerClick: () => {},
    handleBranchTriggerClick: () => {},
    handleLocationTriggerClick: () => {},
  });
  return renderToStaticMarkup(
    React.createElement(SessionInfoPillGroup, { segments })
  );
}

describe("SessionInfoPillGroup", () => {
  it("renders the production row with only the branch consuming remaining width", () => {
    const markup = renderRow(scenarios[0]);
    expect(markup).not.toContain("flex-wrap");
    expect(markup).toContain("max-w-full");
    expect(markup.match(/flex-1/g)).toHaveLength(1);
    expect(renderRow(scenarios[5])).not.toContain("flex-1");
  });

  // CI's default Vitest environment has no browser. Opt in explicitly with a
  // headless Chrome executable; once configured, missing UI/overflow is a hard
  // failure. This is component layout coverage, not packaged Tauri E2E.
  it.skipIf(!process.env.ORGII_HEADLESS_CHROME)(
    "keeps long labels on one bounded row at narrow and wide widths in both themes",
    async () => {
      const artifactDir = process.env.ORGII_LAYOUT_ARTIFACT_DIR;
      const directory =
        artifactDir ??
        (await mkdtemp(path.join(tmpdir(), "orgii-session-info-layout-")));
      await mkdir(directory, { recursive: true });
      try {
        const cssPath = path.resolve("src/tailwind.css");
        const { css } = await postcss([
          tailwindcss() as postcss.Plugin,
        ]).process(await readFile(cssPath, "utf8"), { from: cssPath });
        const fixtures = ["light", "dark"]
          .flatMap((theme) =>
            scenarios.map(
              (scenario) =>
                `<section data-case="${theme}-${scenario.name}" data-width="${scenario.width}" data-branch="${!scenario.hideBranch}" class="${theme}"><h2>${theme}: ${scenario.name} (${scenario.width}px)</h2><div data-row style="width:${scenario.width}px">${renderRow(scenario)}</div></section>`
            )
          )
          .join("");
        const html = `<!doctype html><meta charset="utf-8"><style>${css}
          body { margin: 24px; font-family: Arial, sans-serif; }
          section { padding: 10px; margin-bottom: 6px; }
          h2 { margin-bottom: 4px; font-size: 12px; }
          .light { background: #fff; --color-text-1: #222; --color-border-2: #ddd; --color-fill-3: #eee; }
          .dark { background: #222; color: #eee; --color-text-1: #eee; --color-border-2: #555; --color-fill-3: #444; }
        </style>${fixtures}<script>
          const results = [...document.querySelectorAll('[data-case]')].map(section => {
            const group = section.querySelector('[data-row]').firstElementChild;
            const rect = group.getBoundingClientRect();
            const buttons = [...group.querySelectorAll('button')];
            const label = buttons.at(-1).querySelector('.truncate');
            return {
              name: section.dataset.case, width: rect.width, available: Number(section.dataset.width),
              sameRow: buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 0.5),
              contained: buttons.every(button => button.getBoundingClientRect().right <= rect.right + 0.5),
              count: buttons.length, hasBranch: section.dataset.branch === 'true',
              labelWidth: label.clientWidth, labelScrollWidth: label.scrollWidth,
            };
          });
          const output = document.createElement('pre'); output.id = 'layout-results'; output.hidden = true;
          output.textContent = JSON.stringify(results); document.body.append(output);
        </script>`;
        const htmlPath = path.join(directory, "session-info-layout.html");
        await writeFile(htmlPath, html);
        const { stdout } = await promisify(execFile)(
          process.env.ORGII_HEADLESS_CHROME!,
          [
            "--no-sandbox",
            "--headless",
            "--disable-gpu",
            "--dump-dom",
            "--window-size=1000,1300",
            `--screenshot=${path.join(directory, "session-info-layout.png")}`,
            pathToFileURL(htmlPath).href,
          ],
          { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }
        );
        const match = stdout.match(
          /<pre id="layout-results"[^>]*>([^<]+)<\/pre>/
        );
        expect(
          match,
          "browser must return measurements from rendered production components"
        ).not.toBeNull();
        const results = JSON.parse(match![1]) as Array<{
          name: string;
          width: number;
          available: number;
          sameRow: boolean;
          contained: boolean;
          count: number;
          hasBranch: boolean;
          labelWidth: number;
          labelScrollWidth: number;
        }>;
        expect(results).toHaveLength(scenarios.length * 2);
        for (const result of results) {
          expect(result.sameRow, result.name).toBe(true);
          expect(result.contained, result.name).toBe(true);
          expect(result.width, result.name).toBeLessThanOrEqual(
            result.available + 0.5
          );
          expect(result.count, result.name).toBe(result.hasBranch ? 3 : 2);
          if (result.name.endsWith("-wide"))
            expect(result.labelWidth).toBeGreaterThan(180);
          if (result.name.endsWith("-narrow"))
            expect(result.labelScrollWidth).toBeGreaterThan(result.labelWidth);
        }
      } finally {
        if (!artifactDir) await rm(directory, { recursive: true, force: true });
      }
    },
    60000
  );
});
