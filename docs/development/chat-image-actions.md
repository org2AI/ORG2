# Chat image actions

Desktop chat image menus expose Add to chat, Copy image, Reveal in Finder/file
manager, and Download copy. They are available on message thumbnails, rendered
markdown images and the image preview. Draft/edit thumbnails omit Add to chat.
Existing left-click preview, gallery navigation and remove controls remain.

## Ownership and transitions

The original image reference and optional proven local path are separate from
the display URL. A `blob:` URL is never treated as a filesystem path. Embedded
transcript references do not prove a file exists on this machine. Those and
remote/data images disable Reveal. File-backed drafts retain an optional local
path; older drafts without it still load. There is no database migration or
historical data deletion. Rolling back leaves older readers able to ignore this
optional draft field.

`ChatViewLiveRegion` owns an ImageActionsProvider. Only its writable, non-edit,
attachment-enabled InputArea registers an attachment target. The target is a
scoped capability (abort signal, add callback and focus callback), not another
copy of attachment state. Read-only/missing targets disable Add.

The add path is native menu -> image bytes -> File -> the existing
useImageAttachment optimizer -> chatImageAttachmentsAtom -> existing per-session
image draft persistence -> existing submit/queue flow. Add preserves text and
existing attachments and never sends a message itself.

| State/event                                    | Behavior                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Idle                                           | No menu-related file/network reads or polling                                                    |
| Menu open                                      | Capture this image and this surface's registered composer                                        |
| Preparing                                      | One operation per image action hook; repeated callbacks ignored; controls expose busy state      |
| Added                                          | Close the preview when applicable, then focus the composer after the modal focus trap is removed |
| Full draft                                     | Existing five-image warning; preserve accepted attachments                                       |
| Read/copy/save failure                         | Error feedback, release busy state, allow retry                                                  |
| Native save cancelled                          | No write and no error                                                                            |
| Composer switches/unmounts/becomes unavailable | Abort its read and reject late optimization writes; cancel pending focus frame                   |
| Image/gallery selection changes                | Abort old work and invalidate callbacks from its old menu                                        |
| Unsupported attachment format                  | Same format policy as the existing composer; reject instead of silently reporting success        |

The authoritative attachment write now rechecks capacity inside the atom update.
Previously concurrent imports could both pass the count check before optimization
and append more than five images. Tests force another import to fill the draft
while this one prepares and prove the commit cannot exceed the cap. Historical
draft restore remains unchanged and does not destructively clamp existing data.

## Platform operations and resource limits

Copy from native menus uses `clipboard_write_image` because native IPC callbacks
do not carry WebKit user activation. RGBA travels as a binary IPC body with width
and height headers, avoiding a large JSON number array. Rust validates dimensions,
overflow, exact byte count and the 16,777,216-pixel cap before writing through the
existing arboard clipboard façade on a blocking task. Toolbar copy retains the
synchronous ClipboardItem promise path tested for browser gesture compatibility.

Desktop download uses the native save dialog and original bytes where available.
Reads are capped at 32 MiB (stat before local read; incrementally bounded remote
stream) and remote work times out after 30 seconds. Requests, readers, image object
URLs and canvases are disposed after completion/cancellation. Browser fallback
retains the existing anchor download behavior. Cross-origin servers may reject
image-byte access; this is reported as an error rather than bypassing credentials
or reporting success. No persistent image-byte cache is introduced.

## Architecture coverage

| Layer           | Assessment                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation   | TypeScript typecheck and complete `cargo check -p org2` pass                                                                                       |
| 2 Deduplication | Copy/download action implementation shared by thumbnails and overlay; existing session-creation thumbnail sweep remains separate                   |
| 3 Naming        | ImageActionSource distinguishes src, localPath and fileName                                                                                        |
| 4 Semantics     | Display URL, local file identity and composer ownership are separate                                                                               |
| 5 Defaults      | Missing writable target/local path disable the corresponding operation; draft previews explicitly omit Add                                         |
| 6 Boundaries    | Shared components know only an attachment capability; no import from shared image UI into ChatPanel; dependency check has zero new forbidden edges |
| 7 Readability   | Native clipboard gesture constraint and ownership/cleanup are documented at the implementing boundary                                              |
| 8 Wire          | Binary request and dimension headers asserted in frontend tests; Rust validates the payload; command registered in the application handler list    |
| 9 Entry parity  | Menu add uses the same preparation/optimizer/atom write path as paste and file imports; test helpers do not replace the write                      |
| 10 Resolution   | Gallery actions use the selected original reference, filename and rendered source together; tests invalidate stale menu callbacks                  |

## Audit findings

The review covered all ten architecture layers and the UI/performance surfaces
below. It closed two additional asynchronous edges: check cancellation again
after preparing save bytes and before the filesystem write, and suppress copy
success feedback after the image scope is disposed. Regression tests exercise
both interleavings. Preview/remove controls use shared Button with sibling actions;
there are no nested buttons or new raw form controls.

## Verification

Checks ran in an isolated feature worktree based on `58898f47d` from develop.

- `pnpm test src/components/ImageActions src/scaffold/ImagePreviewOverlay src/engines/ChatPanel/ChatImageThumbnail/index.test.ts src/components/MarkDown/MarkdownLocalImage.test.ts`: 64 passed across six files
- `pnpm exec vitest run --config config/vitest.config.ts src/components/ImageActions src/scaffold/ImagePreviewOverlay src/engines/ChatPanel/ChatImageThumbnail/index.test.ts src/components/MarkDown/MarkdownLocalImage.test.ts src/engines/ChatPanel/hooks/useInputArea/__tests__/useSubmitMessage.test.ts --maxWorkers=1`: 85 passed across seven files
- The first concurrent seven-file run had one failure in the existing captured-message concurrency test (82 passed). `pnpm exec vitest run --config config/vitest.config.ts src/engines/ChatPanel/hooks/useInputArea/__tests__/useSubmitMessage.test.ts --maxWorkers=1` passed all 21 tests separately on both this branch and an untouched develop worktree. The sending implementation was not changed; the intermittent concurrent-run failure remains disclosed.
- `pnpm typecheck:fast`: passed
- ESLint on the changed TypeScript/TSX production files and new tests with `--max-warnings 0`: passed
- `cargo test -p key_vault validates_rgba_payload_before_clipboard_access --lib`: one test passed on the isolated branch
- `cargo check -p org2 --locked`: passed after supplying the existing local sidecar to the isolated build environment
- `pnpm check:boundaries`: zero new forbidden edges (three existing edges)
- `pnpm check:i18n-keys`: passed; zero new missing/unused keys, locale gaps, extras or placeholder mismatches
- `pnpm check:test-placement`: passed across 619 directories
- Targeted `git diff --check`, changed Rust-file formatting and production action-control AST inspection: passed

| Area               | Verdict | Evidence                                                                     | Change or reason kept                                                         | Verification                                                   |
| ------------------ | ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Background work    | keep    | No polling; one remote timeout per user action; one focus frame per composer | Clear timeout/listeners in finally; cancel focus on target teardown           | Timeout and focus-switch tests                                 |
| Memory             | keep    | 32 MiB read cap, pixel cap, no global image cache                            | Binary clipboard payload; release reader/URL/canvas                           | Oversized read, native-copy cleanup, Rust payload validation   |
| Scope/isolation    | fix     | Captured composer capability plus operation signal                           | Reject stale menu, network and optimizer results                              | Two-surface, session-switch, unmount and duplicate-click tests |
| Rendering/hot path | keep    | Provider is a ref; no transcript/global-stream subscription                  | Reads begin only on user action; original browser lazy image loading retained | Idle-read and existing thumbnail tests                         |

| Lifecycle dimension                           | Required behavior and evidence                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start / idle / hidden / focus return          | No image-menu reads, polling or retained byte cache before a user action; idle-read tests pass. Native visible/hidden CPU and RSS measurements not run                  |
| Active / offline / retry                      | One operation per image hook; remote failures and the 30-second timeout release the operation so the user can retry; covered by tests                                   |
| Session switch / composer unmount / read-only | Captured capability aborts and rejects both late reads and optimized attachment commits; covered by switch, disabled-target and unmount tests                           |
| Image switch / modal close                    | Previous image operations abort; late clipboard feedback is suppressed; save checks disposal before writing; covered by tests                                           |
| Multiple chat surfaces                        | Each provider owns its composer capability; two-surface tests verify no cross-chat attachment writes                                                                    |
| Account / endpoint / org / secondary instance | No new auth, transport, provider-ingestion or shared app-lifetime cache is introduced. These existing lifecycles and real secondary-process behavior were not exercised |
| Shutdown                                      | React teardown aborts frontend work and releases listeners/focus frames; a filesystem or OS clipboard command already dispatched cannot be retracted                    |

Performance verdict: **blocked for real runtime measurement**. Automated lifecycle
checks pass, but the running desktop app is an existing packaged build. This task
has not rebuilt/replaced that application or measured native visible/hidden idle
CPU/RSS. New-binary macOS clipboard paste, Finder selection, save cancellation,
theme screenshots and actual provider send with the reattached image remain
manual verification items. Existing submit regression tests ran; they are not a
claim that a live model request or an OS interaction was performed.
