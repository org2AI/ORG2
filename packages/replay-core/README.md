# @orgii/replay-core

Private, framework-independent replay algorithms used by the ORGII frontend.

- `/shell`: UTF-8-safe frame truncation, immutable watermarks, visual rows,
  frame window merging, bounded cache instances, and stale request guards
- `/timeline`: cursor-to-event lookup and turn segment layout

The host provides events, transport callbacks, and cache lifetime. This package
has no application, React, Jotai, or Tauri dependency. The application's shared
cache instance stays in its own adapter. Existing timestamp ordering and replay
watermark semantics are preserved; this is not a full terminal emulator.

Run `pnpm --filter @orgii/replay-core test`, `typecheck`, or `build` from the
repository root. Tests run without application mocks. Source exports are intended
for the frontend bundlers; this private package is not an npm release.
