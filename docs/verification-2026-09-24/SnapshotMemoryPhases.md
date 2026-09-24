# Snapshot memory phase verification

Date: 2026-09-24. Tested a disposable combined checkout of snapshot head `2b6d54be5a5bf518d92e4da3b64c641897f80de6` plus the unmodified storage-isolation implementation `17ada499d17c06e5fdd939f368f90a6c93f0cf59` from #2137. The patch applied without conflicts. Neither PR was merged. This is a follow-up to `ContinuationFileSnapshots.md`, not a replacement for its historical failure record.

## Method and scope

Executed `python3 /tmp/org2-snapshot-phases/run.py`: the repository WDIO harness built and launched one macOS Tauri debug application with a fresh owned home, empty credential seed, fixture workspace, and offline login precondition. The native auth-profile command returned that home's own auth file. Production snapshot/outbox IPC commands were used directly. No authenticated cloud delivery worker, model request, cloud write, or rendered attachment action was exercised in this run.

The fixture contains three revisions of a 32 MiB file. All three were captured before any read. Then the source was overwritten, the same revisions were re-enqueued, and the source was deleted. Six reads cycled over the three receipts. Every read reported `captured`, the original SHA-256, and a base64 length of 44,739,244. A local claim/settle operation simulated a successful transport acknowledgment for each job; this verifies local release, **not a real upload**.

Native process RSS was sampled approximately every 50 ms, separately for each phase, with three-second gaps. This is a sampled lower bound on peak RSS, not heap-allocation accounting. WebKit/driver/build-process memory is excluded. The run is not directly comparable to the earlier baseline because it uses a combined debug build and a different startup state.

## Results

WDIO completed **1 passing case**. All six reads preserved the independently computed original SHA-256: `f7bf48bb2564d7837e748ffe9387ba7403e89de460f2f49a9d7c1c327a67ba33`.

| Phase                           | Duration | Native start RSS | Sampled peak RSS | End RSS   |
| ------------------------------- | -------- | ---------------- | ---------------- | --------- |
| Initial idle                    | 20 s     | 215.0 MiB        | 215.0 MiB        | 213.8 MiB |
| Capture revision 1              | 196 ms   | 213.8 MiB        | 350.7 MiB        | 350.7 MiB |
| Capture revision 2              | 175 ms   | 334.2 MiB        | 403.4 MiB        | 403.4 MiB |
| Capture revision 3              | 166 ms   | 398.6 MiB        | 430.6 MiB        | 430.6 MiB |
| First read IPC                  | 897 ms   | 430.7 MiB        | 516.1 MiB        | 516.1 MiB |
| Second read IPC                 | 896 ms   | 516.0 MiB        | **585.0 MiB**    | 516.0 MiB |
| Sixth read IPC                  | 881 ms   | 431.8 MiB        | 451.7 MiB        | 451.7 MiB |
| Idle after local acknowledgment | 20 s     | 465.6 MiB        | 468.2 MiB        | 388.7 MiB |
| Hidden after release            | 20 s     | 393.9 MiB        | 394.9 MiB        | 288.2 MiB |

The six read calls took 881–897 ms. A post-release native SQLite read-back confirmed three `uploaded` receipts with NULL payloads, zero pending-byte usage, and zero benchmark outbox jobs. The temporary source was absent. Thus the durable bytes were released, even though process RSS did not immediately return to its initial level.

The initial and post-release visible idle windows each used approximately 0.05% native CPU. A `vmmap` diagnostic overlapped the hidden window, so hidden CPU is not treated as a clean idle measurement. That diagnostic reported a **491.8 MiB peak physical footprint** and 296.5 MiB current footprint, with 138.7 MiB resident in `MALLOC_LARGE (empty)`. This is evidence of allocator-retained pages after release; it does not attribute every peak allocation or prove absence of a leak. A separate three-second native stack sample ran before the initial idle phase and was dominated by wait calls.

## Interpretation and remaining work

The measured peak is incurred in **both** persistence and read/IPC, not only during network transfer. There was no network upload in this run. The producing paths are:

- `shared_file_outbox::cloud_file_outbox_enqueue` captures the file into a full `Vec<u8>` and writes a SQLite BLOB. Database connections are pooled and configured with a 64,000 KiB page-cache target per connection.
- `snapshots::read` copies the BLOB into another `Vec<u8>`, verifies its hash, then creates a full base64 string that is serialized through Tauri IPC. A 32 MiB payload expands to approximately 42.7 MiB before JSON/transport overhead.
- Successful local settlement sets receipt bytes to NULL and removes the outbox row; SQLite read-back proves that invariant. Allocator and page-cache residency have a different lifecycle from durable pending-byte accounting.

The 32 MiB file limit and 256 MiB durable pending-byte budget are **not process-memory limits**. Raising either budget would not resolve the measured allocation cost. A bounded-memory read/transport design and an explicit active-memory budget need implementation and repeated measurement before performance acceptance. This run does not establish a long-duration steady state, quantify per-allocation ownership, test concurrent readers, or cover full provider continuation, upgrades, other platforms, or the complete bilateral stack.

No startup watchdog fired in this one-instance run. The separate two-instance run on #2137 did fire a hidden-startup watchdog; that defect remains open. Other warnings here concerned the deprecated atom helper, native transparency lookup, and the unsupported symlinked debug-executable path used by automatic update checks. The owned native process exited, and temporary webpack/Tauri configuration changes were restored. Existing user applications were not stopped. No old global scratchpad tree was swept.

**Performance verdict: blocked.** Immutability and local release assertions pass; the large active-memory cost remains an open acceptance issue. The configured real-provider endpoint also still fails DNS resolution, so no real-provider continuation pass is claimed.
