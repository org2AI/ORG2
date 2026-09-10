/**
 * Creator default product mode atom
 *
 * Persists the session creator's composer-mode selection on the PRODUCT
 * axis (orgtrack/v1 §5.2). Only the `project` selection is stored — the
 * plain exec modes (`build`/`plan`/`ask`) live in
 * `creatorDefaultExecModeAtom`, and `project` additionally derives
 * `build` there. Launch reads this atom to stamp `productMode` on the
 * new session so it boots inside the persistent work graph.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { PRODUCT_MODE_PROJECT } from "@src/config/sessionCreatorConfig";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

const STORAGE_KEY = "orgii:creatorProductMode";

export type CreatorDefaultProductMode = typeof PRODUCT_MODE_PROJECT | null;

const StoredProductModeSchema = z.literal(PRODUCT_MODE_PROJECT).nullable();

export const creatorDefaultProductModeAtom =
  atomWithStorage<CreatorDefaultProductMode>(
    STORAGE_KEY,
    null,
    createZodJsonStorage(StoredProductModeSchema),
    { getOnInit: true }
  );
