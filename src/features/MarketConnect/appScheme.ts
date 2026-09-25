import { z } from "zod/v4";

/** Schemes emitted by the desktop build profiles and isolated Market tests.
 * Keep aligned with market-connect/environment.rs; callback ownership still
 * requires the exact compiled scheme, not merely membership in this set. */
export const marketAppSchemeSchema = z.string().regex(
  // Unlike $, the final lookahead also rejects a trailing newline.
  /^orgii(?:-dev|-instance(?:[2-9]|[1-9][0-9])|-market-local-[a-f0-9]{8})?(?![\s\S])/
);
