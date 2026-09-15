import { z } from "zod/v4";

import { type Connection, connectionSchema } from "./rpc";

const selectionSchema = z.object({
  metadata: connectionSchema,
  entitlement_id: z.string().min(1),
});

/** Public durable selection only; never derive navigation from error text. */
export function sessionMarketConnection(
  source: string | undefined
): Connection | null {
  if (!source?.startsWith("market:") || source.length > 1024) return null;
  const encoded = source.slice(7);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const parsed = selectionSchema.safeParse(
      JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")))
    );
    return parsed.success ? parsed.data.metadata : null;
  } catch {
    return null;
  }
}

export function requiresMarketReauthorization(message: string): boolean {
  return /\b(?:credential_store_read_failed|credential_store_unavailable|market_reauthorization_required)\b/.test(
    message
  );
}
