import { z } from "zod/v4";

import { defineProcedure, typedInvoke } from "@src/api/tauri/rpc/invoke";

const epochSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const suspend = defineProcedure("market_connection_suspend_owner")
  .output(epochSchema)
  .build();
const synchronize = defineProcedure("market_connection_sync_owner")
  .input(z.object({ epoch: epochSchema.nullable() }))
  .output(z.null())
  .build();

export const suspendNativeCloudOwner = async () =>
  epochSchema.parse(await typedInvoke(suspend));
export const synchronizeNativeCloudOwner = async (
  epoch: number | null = null
): Promise<void> => {
  await typedInvoke(synchronize, { epoch });
};

/** Equality only: native code independently reads and verifies the auth store. */
export function serializedCloudOwner(value: string | null): string | null {
  if (value === null) return null;
  try {
    const auth: unknown = JSON.parse(value);
    if (
      typeof auth !== "object" ||
      auth === null ||
      !("kind" in auth) ||
      auth.kind !== "org2_cloud" ||
      !("supabaseUrl" in auth) ||
      typeof auth.supabaseUrl !== "string" ||
      !("userId" in auth) ||
      typeof auth.userId !== "string" ||
      !auth.userId
    )
      return null;
    return JSON.stringify([
      auth.supabaseUrl.trim().replace(/\/+$/, ""),
      auth.userId,
    ]);
  } catch {
    return null;
  }
}
