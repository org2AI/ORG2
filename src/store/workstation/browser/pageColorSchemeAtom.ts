/**
 * Browser Page Color Scheme Atom
 *
 * The `prefers-color-scheme` browsed pages are told the user wants: `auto`
 * follows the app theme (the behavior from before this preference existed),
 * `light` / `dark` force it for pages only. Chosen from the URL bar's "..."
 * menu and pushed to the native webviews by `useBrowserPageColorSchemeSync`.
 *
 * The values are the wire format of the `browser_webviews_set_color_scheme`
 * command; keep them in step with `BrowserColorScheme::parse` on the Rust side.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

export const BROWSER_PAGE_COLOR_SCHEMES = ["auto", "light", "dark"] as const;

export type BrowserPageColorScheme =
  (typeof BROWSER_PAGE_COLOR_SCHEMES)[number];

export const BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY =
  "orgii:browser:pageColorScheme";

const DEFAULT_BROWSER_PAGE_COLOR_SCHEME: BrowserPageColorScheme = "auto";

export const browserPageColorSchemeAtom =
  atomWithStorage<BrowserPageColorScheme>(
    BROWSER_PAGE_COLOR_SCHEME_STORAGE_KEY,
    DEFAULT_BROWSER_PAGE_COLOR_SCHEME,
    createZodJsonStorage(z.enum(BROWSER_PAGE_COLOR_SCHEMES)),
    { getOnInit: true }
  );
browserPageColorSchemeAtom.debugLabel = "browserPageColorSchemeAtom";
