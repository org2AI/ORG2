import tailwindcss from "@tailwindcss/postcss";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import postcss from "postcss";

export interface LayoutFixture {
  name: string;
  width: number;
  markup: string;
}

export interface LayoutMeasurement {
  name: string;
  width: number;
  contained: boolean;
  noHorizontalScroll: boolean;
  iconsVisible: boolean;
  dividersAttached: boolean;
  branchLabelWidth: number;
  branchLabelScrollWidth: number;
  buttonCount: number;
  disabledCount: number;
  wrapped: boolean;
  sameNodes: boolean;
}

/** Renders production markup/CSS in Chrome. Parent widths simulate workstation
 * allocation; this is not the application's workstation toggle or Tauri E2E. */
export async function measureSessionInfoLayout(fixtures: LayoutFixture[]) {
  const artifactDir = process.env.ORGII_LAYOUT_ARTIFACT_DIR;
  const directory =
    artifactDir ??
    (await mkdtemp(path.join(tmpdir(), "orgii-session-info-line-layout-")));
  await mkdir(directory, { recursive: true });
  try {
    const cssPath = path.resolve("src/tailwind.css");
    const { css } = await postcss([tailwindcss() as postcss.Plugin]).process(
      await readFile(cssPath, "utf8"),
      { from: cssPath }
    );
    const cases = ["light", "dark"]
      .flatMap((theme) =>
        fixtures.map(
          (
            fixture
          ) => `<section class="${theme}" data-case="${theme}-${fixture.name}">
          <h2>${theme}: ${fixture.name} (${fixture.width}px)</h2>
          <div data-parent style="width:${fixture.width}px" class="flex flex-col">
            ${fixture.name === "compact-parent" ? '<div class="flex w-full items-center gap-2"><span class="shrink-0" style="width:96px">Agent</span><div class="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-0.5">' : ""}<div data-row class="flex w-full flex-wrap items-center justify-start gap-0.5">${fixture.markup}</div>${fixture.name === "compact-parent" ? "</div></div>" : ""}
          </div></section>`
        )
      )
      .join("");
    const html = `<!doctype html><meta charset="utf-8"><style>${css}
      body { margin: 24px; font-family: Arial, sans-serif; }
      section { padding: 10px; margin-bottom: 6px; }
      h2 { margin-bottom: 4px; font-size: 12px; }
      .light { background: #fff; --color-text-1: #222; --color-border-2: #ddd; --color-fill-3: #eee; }
      .dark { background: #222; color: #eee; --color-text-1: #eee; --color-border-2: #555; --color-fill-3: #444; }
    </style>${cases}<script>
      const results = [];
      function measure(section, suffix = '') {
        const parent = section.querySelector('[data-parent]');
        const row = section.querySelector('[data-row]');
        const bounds = parent.getBoundingClientRect();
        const buttons = [...row.querySelectorAll('button')];
        const branch = row.querySelector('[aria-label="selectors.sessionInfo.branchAria"]');
        const label = branch?.querySelector('.truncate');
        const selectorButtons = buttons.filter(button => button.getAttribute('aria-label')?.startsWith('selectors.sessionInfo.'));
        const dividers = [...row.querySelectorAll('span[aria-hidden]')]
          .filter(node => node.classList.contains('w-px'));
        const visible = rect => rect.width > 0 && rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5;
        const centerY = rect => (rect.top + rect.bottom) / 2;
        results.push({
          name: section.dataset.case + suffix, width: bounds.width,
          contained: buttons.every(button => visible(button.getBoundingClientRect())),
          noHorizontalScroll: parent.scrollWidth <= parent.clientWidth && row.scrollWidth <= row.clientWidth,
          iconsVisible: selectorButtons.every(button => {
            const rect = button.getBoundingClientRect();
            const icons = [...button.querySelectorAll('svg')].filter(icon => icon.getClientRects().length > 0);
            return icons.length > 0 && icons.every(icon => {
              const iconRect = icon.getBoundingClientRect();
              return visible(iconRect) && iconRect.left >= rect.left && iconRect.right <= rect.right;
            });
          }),
          dividersAttached: dividers.every(divider => {
            const rect = divider.getBoundingClientRect();
            if (!rect.width || getComputedStyle(divider).visibility === 'hidden') return true;
            const rowButtons = buttons.filter(button => Math.abs(centerY(button.getBoundingClientRect()) - centerY(rect)) < 1);
            return rowButtons.some(button => button.getBoundingClientRect().right <= rect.left + 0.5)
              && rowButtons.some(button => button.getBoundingClientRect().left >= rect.right - 0.5);
          }),
          branchLabelWidth: label?.clientWidth ?? 0,
          branchLabelScrollWidth: label?.scrollWidth ?? 0,
          buttonCount: buttons.length, disabledCount: buttons.filter(button => button.disabled).length,
          wrapped: buttons.some(button => Math.abs(centerY(button.getBoundingClientRect()) - centerY(buttons[0].getBoundingClientRect())) > 1),
          sameNodes: !section.originalButtons || buttons.every((button, index) => button === section.originalButtons[index]),
        });
      }
      for (const section of document.querySelectorAll('[data-case]')) {
        measure(section);
        if (section.dataset.case.endsWith('-resize')) {
          section.originalButtons = [...section.querySelectorAll('button')];
          // CSS allocation changes exercise the production row's layout, not a
          // synthetic workstation click. Same DOM nodes must survive each step.
          for (const width of [600, 480, 400, 360, 320, 280, 260, 280, 320, 360, 400, 480, 600, 900]) {
            section.querySelector('[data-parent]').style.width = width + 'px';
            measure(section, '-step-' + results.length);
          }
        }
      }
      const output = document.createElement('pre'); output.id = 'line-layout-results'; output.hidden = true;
      output.textContent = JSON.stringify(results); document.body.append(output);
    </script>`;
    const htmlPath = path.join(directory, "session-info-line-layout.html");
    await writeFile(htmlPath, html);
    const { stdout } = await promisify(execFile)(
      process.env.ORGII_HEADLESS_CHROME!,
      [
        "--no-sandbox",
        `--user-data-dir=${path.join(directory, "chrome-profile")}`,
        "--headless",
        "--disable-gpu",
        "--dump-dom",
        "--window-size=1200,2800",
        `--screenshot=${path.join(directory, "session-info-line-layout.png")}`,
        pathToFileURL(htmlPath).href,
      ],
      { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }
    );
    const match = stdout.match(
      /<pre id="line-layout-results"[^>]*>([^<]+)<\/pre>/
    );
    if (!match)
      throw new Error("Chrome returned no production row measurements");
    const results = JSON.parse(match[1]) as LayoutMeasurement[];
    await writeFile(
      path.join(directory, "session-info-line-results.json"),
      JSON.stringify(results, null, 2)
    );
    return results;
  } finally {
    if (!artifactDir) await rm(directory, { recursive: true, force: true });
  }
}
