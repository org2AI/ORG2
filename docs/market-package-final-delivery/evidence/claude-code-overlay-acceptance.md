# Claude Code overlay — private-build acceptance, 2026-09-17 21:57–22:05Z

Build `f006d33b6` staged as `staging/f006d33b60/ORG2 Instance 89.app`, started
through the clean launcher over the previous `84330574d4` instance.

1. **Startup migration**: the instance's legacy manifest (mode `orgii_managed`,
   target = the external-home `settings.json`, no default backup because ORG2
   had created the file) was restored: manifest → `default`, file removed.
   Log: `[CLI Managed Config] restored native files replaced by overlays
   restored=1 conflicts=0`. Proxy not started (no active connection). App
   Connections showed "Original setup".
2. **Apply** (Configure → ORG2 Market → `[Acceptance] Sonnet overlap` +
   `Coding for beginner` → Use this connection): overlay written to
   `~/.orgii-instance89/cli-config-profiles/claude_code/overlay/settings.json`
   with exactly `env`, `model`, `modelPicker`, `availableModels`; manifest
   target is the overlay; the external-home `settings.json` still does not
   exist; proxy listening on 17976; the card shows the overlay path text and
   `Edit / Open terminal / Disconnect`.
3. **Open terminal**: launcher `~/.orgii-instance89/market/open-claude_code.command`
   is `unset … ; cd -- '/Users/vinceorz'; exec 'claude' --settings '<overlay>'`
   (no `CLAUDE_CONFIG_DIR`); a `claude --settings <overlay>` process started.
4. **Real call** with the same overlay under `env -i`
   (`claude -p --settings <overlay> --model <beginner alias>`): reply
   `PACKAGE-OVERLAY-FINAL-OK`; ledger verified two new requests — foreground
   `Coding for beginner` (buyer 47151 µUSD) and the automatic title call on
   `[Acceptance] Sonnet overlap` (2294 µUSD), both completed, reserve 0.

Observation outside this change: the session-provenance hook reconciliation
that runs at every launch writes hooks into the user's real
`~/.claude/settings.json` (it does not honour `ORGII_EXTERNAL_HISTORY_HOME`);
the hooks there currently point at the acceptance root. Tracked as row 11.
