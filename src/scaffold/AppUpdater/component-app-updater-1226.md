# AppUpdater

**Location:** `src/scaffold/AppUpdater/`
**Last updated:** September 7, 2026

## Overview

`AppUpdater` is the update confirmation and progress UI mounted by
`AppDeferredServices`. It starts the automatic scheduler through `service.tsx`,
which owns the shared coordinator for check, download, and install state.

Small consumers import actions from `actions.ts` and read hooks from `state.ts`.
Actions load `service.tsx` on demand; they do not import the confirmation UI or
start automatic scheduling. The mounted UI and manual actions share the same
service singleton.

Update checks and package downloads are always automatic. Installation and
relaunch remain explicit user actions.

## Automatic behavior

- **Startup:** after a 10-second delay, check for a fresh release. If one is
  available, download it and ask before installing or relaunching ORGII.
- **While running:** check every two visible hours, when the app returns to the
  foreground, and when network connectivity returns. Interval work pauses while
  the document is hidden.
- **Foreground event deduplication:** focus and visibility events share one
  750 ms debounce path; checks also have a five-minute throttle.
- **Failure recovery:** keep one retry timer and one in-flight automatic run.
  Failed checks or downloads retry after a jittered exponential delay beginning
  near one minute and capped near one hour. Hidden/offline time pauses the retry,
  and focus/online events cannot bypass its cooldown.
- **Silent preparation:** download an available package in the background
  without showing progress toasts or forcing a restart, then show one
  confirmation dialog. Installation only starts after the user confirms.
- **Dialog actions:** users can skip the detected version, postpone the
  decision for 24 hours while keeping the package ready, or install and restart.
  Skipped versions remain suppressed across app launches.

Installing is never automatic because the Tauri updater installer can
terminate the running process on Windows. Users can postpone installation and
save ongoing work before confirming the restart.

## Public API

Import commands from `./actions` and read hooks from `./state`.

```ts
checkForAppUpdates({ notify?: boolean, force?: boolean }): Promise<Update | null>
checkForUpdatesManually(): Promise<Update | null>
installAvailableAppUpdate(): Promise<void>
useAvailableAppUpdate(): Update | null
useIsAppUpdateInstalling(): boolean
```

- `notify` shows toast feedback for the caller.
- `force` bypasses the five-minute result throttle, but never starts a second
  concurrent check.
- Manual check failures clear a stale available-update result. Silent failures
  preserve the last successful result while marking the coordinator failed.
- Download requests prepare the package and open the install confirmation.
- Concurrent confirmed install requests share one install; only the owning
  request may continue to relaunch.
- Automatic triggers share one end-to-end run, so simultaneous focus, online,
  interval, and retry events cannot duplicate the request chain.

## State model

```text
idle → checking → up-to-date | available | failed
available → downloading → downloaded
available | downloaded → installing → relaunching
```

`appUpdaterCoordinator.ts` owns this lifecycle. Jotai atoms in `state.ts` are
read-only UI projections and are not independent sources of truth.

## Entry points

- Automatic scheduling: `AppDeferredServices` → `AppUpdater`
- Manual check: Settings, Global Spotlight, ActionSystem
- Manual install: sidebar update button and ChatPanel update action

## Dependencies

- `@tauri-apps/api/app` for the current version
- `@tauri-apps/plugin-updater` for check/download/install
- `@tauri-apps/plugin-process` for relaunch
- central settings registry for update-channel selection

## Later reminder policy

`service.tsx` owns the durable reminder decision. Choosing Later stores one
version and an absolute 24-hour deadline in localStorage, then hides the prompt.
Startup, interval, foreground, online recovery, and retry preparation all respect
that deadline for both in-place and separate-application installation. Explicit
install actions may reopen the prompt during the cooldown. A different release
is never suppressed by an older reminder. Expired or malformed records are
removed when read; skipping or confirming installation clears the current
version's reminder. No reminder timer or subscription is added: the next eligible
automatic check after expiry can show the prompt again.
