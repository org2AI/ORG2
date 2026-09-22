# Package Retry projection lifecycle

Scope: chained local Codex Retry, native episode projection, and retained failed
attempt diagnostics. This audit distinguishes source checks from the named
immutable builds' real measurements.

| Area               | Verdict | Evidence                                                                              | Change or reason kept                                                               | Verification                                                                |
| ------------------ | ------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Background work    | keep    | Projection runs on existing snapshot/queue updates                                    | No new timer, watcher, subscription or database read                                | Full and delta projection source review                                     |
| Memory             | keep    | Retry links cap attempts at 64; projection identities are transient sets/row metadata | No new app-lifetime cache or retained registry                                      | Existing lineage cap tests; source inspection                               |
| Scope/isolation    | fix     | Provider-local positional IDs repeated across child executions                        | Compute global source identity before projecting child ownership onto root          | Actual second-Retry UI assembler regression; live/landed identity tests     |
| Rendering/hot path | fix     | Removing a failed prompt boundary let its error absorb a prior lazy reply             | Explicit effective audit boundary preserves grouping; raw history remains untouched | Shared projection fixture and full/delta regressions; final runtime pending |
| Streaming          | keep    | Ordinary assistant/tool deltas process changed records only                           | Lineage changes invalidate the full baseline; no whole-history scan per token       | Streaming snapshot suite and source review                                  |

| Provider                    | Raw transition                                | App/UI state                      | Topology/boundary                              | Expected invariant                                       | Observed evidence                                                                      |
| --------------------------- | --------------------------------------------- | --------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex CLI                   | A append, B failure/Retry, C append           | Live open root                    | Isolated local native → ORG2 → Market receipts | Logical A/B/C once; earlier marker available             | `3efe`: native context and three rendered turns passed; audit grouping failed          |
| Codex CLI                   | Second D failure/Retry                        | Live open root and normal restart | Second native episode → root UI                | D/reply survives episode merge                           | `3efe`: native context/charge passed, rendered D absent; regression fails old source   |
| Codex CLI                   | Positive cached append                        | Live                              | Native usage → Market settlement               | Fresh + cached input counted once                        | `3efe`: 627 + 14,848 + 12 = 15,487; one settlement                                     |
| Codex CLI                   | Corrected projection of preserved raw history | Cold/restart/live continuation    | Final corrected binary                         | A reply and D restored; failed audits separately grouped | `91725`: seven then eight correct turns, H continuation and same-binary restart passed |
| Claude Code / official Apps | Provider-specific append/compaction/rotation  | Final corrected binary            | Local native/UI                                | No implied cross-provider acceptance from Codex evidence | Not rerun for this correction                                                          |

On `3efe`, five short visible-idle samples measured 0.03–0.09% CPU and about
691 MiB summed physical footprint; hide-shortcut samples measured 0.03–0.04%
and about 690 MiB. Normal Quit removed all tracked app/WebKit process identities.
These samples exclude external CLI/tool processes, sustained active load and
long-term memory. They cannot establish a broad performance improvement.

The `300203` runtime restored preserved A/D replies and passed a third original
Retry plus continuation. Its navigator incorrectly counted the retained audit
group as another turn. Explicit projected audit metadata now preserves the error
body while excluding it from turn navigation. Existing memoized projection owns
this metadata; no new timer, subscription, scan, persistent cache or database read
is introduced. Pagination work remains bounded by already materialized groups.
Source regression covers consecutive/trailing/audit-only groups and keeps ordinary
headerless behavior. Five suites / 90 tests, full fast typecheck and scoped lint pass.

Performance verdict: passed for this bounded local Codex projection lifecycle.
Final `91725` restored seven turns, appended H, then retained eight correct turns
through normal Quit/reopen. Five visible samples measured 0.04–0.38% CPU after the
first sample and 604.64–836.85 MiB physical footprint; five hide-shortcut samples
measured 0.11–0.13% and 708.58–709.27 MiB. Three normal-Quit samples tracked zero
remaining App/WebKit resources. These are short samples, not sustained load or
whole-machine measurements; hide-shortcut does not prove document visibility.
Other providers/transitions and overall feature acceptance remain separate gates.
