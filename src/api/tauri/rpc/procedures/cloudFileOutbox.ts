import { z } from "zod/v4";

import { defineProcedure } from "../invoke";

const identity = z.string().min(1).max(2048);
const candidate = z.object({
  path: z.string().min(1).max(8192),
  revision: z.string().min(1).max(1024),
});
const job = candidate.extend({
  id: z.number().int().positive(),
  orgId: z.string(),
  sessionId: z.string(),
  lease: z.string(),
});

export const cloudFileOutbox = {
  enqueue: defineProcedure("cloud_file_outbox_enqueue")
    .input(
      z.object({
        identity,
        orgId: z.string().min(1).max(1024),
        sessionId: z.string().min(1).max(1024),
        candidates: z.array(candidate).max(256),
      })
    )
    .build(),
  readSnapshot: defineProcedure("cloud_file_snapshot_read")
    .input(
      z.object({
        identity,
        orgId: z.string(),
        sessionId: z.string(),
        candidate,
      })
    )
    .output(
      z.object({
        status: z.enum([
          "captured",
          "uploaded",
          "not_captured",
          "integrity_error",
          "invalid_source",
          "source_unavailable",
          "too_large",
          "local_storage_unavailable",
          "atomic_capture_unsupported",
          "source_busy_or_unavailable",
          "local_budget_exceeded",
        ]),
        capturedAt: z.number().nullable(),
        sha256: z.string().nullable(),
        bytesBase64: z.string().nullable(),
      })
    )
    .build(),
  claim: defineProcedure("cloud_file_outbox_claim")
    .input(z.object({ identity, orgIds: z.array(z.string()) }))
    .output(z.object({ job: job.nullable(), retryAt: z.number().nullable() }))
    .build(),
  settle: defineProcedure("cloud_file_outbox_settle")
    .input(
      z.object({
        identity,
        id: z.number().int().positive(),
        lease: z.string(),
        outcome: z.enum([
          "uploaded",
          "retry",
          "quota",
          "source_unavailable",
          "capture_failed",
          "cancelled",
        ]),
      })
    )
    .build(),
} as const;
