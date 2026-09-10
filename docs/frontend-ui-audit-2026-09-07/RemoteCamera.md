# Remote camera pairing audit

Scope: QRScanScreen and the shared platform camera adapter. Audit only; source implementation is preserved from the existing worktree.

| Line                 | Element             | Verdict          | Reason                                                                                               | Suggested change |
| -------------------- | ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| QRScanScreen.tsx:109 | Video preview       | keep with reason | Square black preview is a camera surface, not a replacement design token; it has an accessible label | None             |
| QRScanScreen.tsx:123 | Cancel/scan buttons | keep with reason | Reuses MobileActionButton and keeps paste disabled during capture                                    | None             |
| QRScanScreen.tsx:147 | Paste and error     | keep with reason | Shared Textarea and PageNotice; camera and paste use the same parser                                 | None             |

Totals: fix 0; keep with reason 3; abstract 0. No cross-file design-system sweep proposed.

## Architecture and lifecycle

Reviewed UI intent → platform port → getUserMedia → local decoder → canonical pairing parser. Camera ownership stays in one abortable operation; no credentials are extracted by the decoder. Protocol/persistence/database layers are unchanged. Frames are neither uploaded nor stored. jsqr 1.4.0 is pinned and lazy-loaded; removing the camera port, permission descriptions and dependency restores paste-only pairing without data migration.

| Area               | Verdict | Evidence                                              | Change or reason kept                                                           | Verification                             |
| ------------------ | ------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| Background work    | keep    | One 60-second deadline and one 200ms frame timer      | Abort, success, errors and timeout stop tracks and timers; hidden/unmount abort | Targeted unit suite                      |
| Memory             | keep    | One canvas with maximum 640-pixel long edge           | Clear canvas and video on completion; no frame history                          | Decoder tests; physical RSS not measured |
| Scope/isolation    | keep    | Per-screen AbortController                            | Late permission grants stop acquired tracks after cancellation                  | Cancellation tests                       |
| Rendering/hot path | keep    | Decode outside React; only final result updates state | No frame-level React updates                                                    | Static trace; device CPU not measured    |

Verification: `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/platform/scanCameraQr.test.ts src/modules/MobileRemote/platform/scanCameraQr.decoder.test.ts src/modules/MobileRemote/screens/QRScanScreen.test.ts src/modules/MobileRemote/connection/parseMobileRemoteWsUrl.test.ts`; see PR for outcome. Native permission prompt, denied-permission Settings recovery, real-camera images, light/dark screenshots and physical CPU/RSS are not validated in this audit. Draft must remain until physical verification is complete.

Performance verdict: blocked — real iPhone visible/hidden/post-close measurements are missing; unit tests do not prove device performance.

## Develop integration correction

The removed InlineAlert import is replaced with the canonical PageNotice so this branch compiles against current develop. The alert role and camera/paste validation behavior are preserved. After parent integration: 272 MobileRemote tests in 48 files passed, typecheck and scoped ESLint passed. Real iPhone permission/camera/CPU/RSS remain unverified; no new visual acceptance claim.
