import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

export const sidebarCustomCollapsedAtom = atomWithStorage<string[]>(
  "orgii:sidebarCustomCollapsedSections",
  [],
  createZodJsonStorage(
    z
      .array(z.string())
      .transform((ids) =>
        [
          ...new Set(ids.filter((id) => id.startsWith("custom-section-"))),
        ].slice(-100)
      )
  ),
  { getOnInit: true }
);
