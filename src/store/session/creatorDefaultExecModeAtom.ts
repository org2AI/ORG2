/**
 * Creator default exec mode atom
 *
 * Persists the **session creator's default** `AgentExecMode` to localStorage.
 * Primary use: pre-fill the SessionCreator's mode pill when starting a brand
 * new Rust agent session. Once a session exists, its exec mode lives on the
 * session record (`Session.agentExecMode`) and is the single source of truth.
 *
 * Allowed fallback: dispatcher hooks may read this atom ONLY as a last-resort
 * fallback when the session row has no `agentExecMode` set. In-session UI
 * components (ChatPanel `ModePill`, status bars) must read
 * `session.agentExecMode` directly and must NOT fall back to this atom.
 *
 * Legacy value `"explore"` is migrated to `"ask"` on first read so users do
 * not see an orphaned pill.
 *
 * Storage key kept as `orgii:agentExecMode` for backwards-compat with existing
 * user installs.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { ALL_AGENT_EXEC_MODES } from "@src/config/sessionCreatorConfig";
import type { AgentExecMode } from "@src/features/SessionCreator/config";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

const STORAGE_KEY = "orgii:agentExecMode";

const StoredAgentExecModeSchema = z.preprocess(
  (raw) => (raw === "explore" ? "ask" : raw),
  z.enum([...ALL_AGENT_EXEC_MODES])
);

export const creatorDefaultExecModeAtom = atomWithStorage<AgentExecMode>(
  STORAGE_KEY,
  "build",
  createZodJsonStorage(StoredAgentExecModeSchema),
  { getOnInit: true }
);
