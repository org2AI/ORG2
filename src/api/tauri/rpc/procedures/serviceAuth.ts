import { z } from "zod/v4";

import { defineProcedure } from "../invoke";

export const serviceAuth = {
  getStorageProfile: defineProcedure("shared_service_auth_storage_profile")
    .output(
      z.object({ path: z.string().min(1), allowLegacyMigration: z.boolean() })
    )
    .build(),
} as const;
