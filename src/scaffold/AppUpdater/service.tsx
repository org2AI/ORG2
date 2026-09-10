import { getVersion } from "@tauri-apps/api/app";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  AppUpdateDownloadNoticeContent,
  getDownloadProgressTitle,
} from "./DownloadProgress";
import { AppUpdaterCoordinator } from "./appUpdaterCoordinator";
import {
  AppUpdaterScheduler,
  type AutomaticUpdateReason,
} from "./appUpdaterScheduler";
import {
  type AppBuildProvenance,
  getAppBuildProvenance,
  resetAppBuildProvenanceForTests,
} from "./buildProvenance";
import { checkAppUpdateOnChannel } from "./channelCheck";
import { installAppUpdateSeparately } from "./separateInstall";
import {
  type AppUpdateDownloadProgress,
  EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS,
  appBuildProvenanceAtom,
  appUpdateDownloadProgressAtom,
  appUpdateInstallPromptAtom,
  appUpdaterStateAtom,
  separateAppUpdateInstallingAtom,
} from "./state";

const log = createLogger("AppUpdater");

const STARTUP_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60_000;
const FOREGROUND_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
const FOREGROUND_EVENT_DEBOUNCE_MS = 750;
const DOWNLOAD_PROGRESS_UPDATE_MIN_INTERVAL_MS = 250;
const UPDATE_TOAST_DURATION_MS = 5_000;
const UPDATE_CHECK_TIMEOUT_MS = 30_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const UPDATE_RETRY_BASE_DELAY_MS = 60_000;
const UPDATE_RETRY_MAX_DELAY_MS = 60 * 60_000;
const UPDATE_RETRY_JITTER_RATIO = 0.2;

const CHECK_TOAST_ID = "app-update-check";
const INSTALL_TOAST_ID = "app-update-progress";
const SKIPPED_UPDATE_VERSION_STORAGE_KEY =
  "orgii:updater:skipped-update-version";
const SEPARATELY_INSTALLED_RELEASE_VERSION_STORAGE_KEY =
  "orgii:updater:separately-installed-release-version";

const DEFERRED_UPDATE_REMINDER_STORAGE_KEY =
  "orgii:updater:deferred-update-reminder";
const UPDATE_REMINDER_DEFER_DURATION_MS = 24 * 60 * 60_000;

interface DeferredUpdateReminder {
  version: string;
  remindAfter: number;
}

export interface CheckForAppUpdatesOptions {
  notify?: boolean;
  force?: boolean;
}

function store() {
  return getInstrumentedStore();
}

function setDownloadProgress(progress: AppUpdateDownloadProgress): void {
  store().set(appUpdateDownloadProgressAtom, progress);
}

function collapseDownloadProgressNotice(): void {
  const progress = store().get(appUpdateDownloadProgressAtom);
  if (!progress.active || progress.collapsed) return;
  setDownloadProgress({ ...progress, collapsed: true });
}

function showDownloadProgressNotice(progress: AppUpdateDownloadProgress): void {
  Message.info({
    id: INSTALL_TOAST_ID,
    title: getDownloadProgressTitle(progress),
    content: <AppUpdateDownloadNoticeContent progress={progress} />,
    duration: 0,
    closable: true,
    persistent: true,
    onClose: collapseDownloadProgressNotice,
  });
}

function beginDownloadProgress(): void {
  const progress = {
    ...EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS,
    active: true,
  };
  setDownloadProgress(progress);
  showDownloadProgressNotice(progress);
}

export function expandDownloadProgressNotice(): void {
  const progress = store().get(appUpdateDownloadProgressAtom);
  if (!progress.active) return;
  const expanded = { ...progress, collapsed: false };
  setDownloadProgress(expanded);
  showDownloadProgressNotice(expanded);
}

function endDownloadProgress(): void {
  Message.remove(INSTALL_TOAST_ID);
  setDownloadProgress(EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS);
}

function getSkippedUpdateVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY);
}

function setSkippedUpdateVersion(version: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY, version);
}

function clearSkippedUpdateVersion(version: string): void {
  if (typeof window !== "undefined" && getSkippedUpdateVersion() === version) {
    window.localStorage.removeItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY);
  }
}

function getDeferredUpdateReminder(): DeferredUpdateReminder | null {
  if (typeof window === "undefined") return null;

  const stored = window.localStorage.getItem(
    DEFERRED_UPDATE_REMINDER_STORAGE_KEY
  );
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<DeferredUpdateReminder>;
    if (
      typeof parsed.version === "string" &&
      typeof parsed.remindAfter === "number" &&
      Number.isFinite(parsed.remindAfter) &&
      parsed.remindAfter > Date.now()
    ) {
      return { version: parsed.version, remindAfter: parsed.remindAfter };
    }
  } catch {
    // Invalid persisted state should never suppress an update reminder.
  }

  window.localStorage.removeItem(DEFERRED_UPDATE_REMINDER_STORAGE_KEY);
  return null;
}

function deferUpdateReminder(version: string): void {
  if (typeof window === "undefined") return;
  const reminder: DeferredUpdateReminder = {
    version,
    remindAfter: Date.now() + UPDATE_REMINDER_DEFER_DURATION_MS,
  };
  window.localStorage.setItem(
    DEFERRED_UPDATE_REMINDER_STORAGE_KEY,
    JSON.stringify(reminder)
  );
}

function clearDeferredUpdateReminder(version: string): void {
  if (typeof window === "undefined") return;
  const reminder = getDeferredUpdateReminder();
  if (reminder?.version === version) {
    window.localStorage.removeItem(DEFERRED_UPDATE_REMINDER_STORAGE_KEY);
  }
}

function isUpdateReminderDeferred(version: string): boolean {
  const reminder = getDeferredUpdateReminder();
  return reminder?.version === version;
}

function getSeparatelyInstalledReleaseVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(
    SEPARATELY_INSTALLED_RELEASE_VERSION_STORAGE_KEY
  );
}

function setSeparatelyInstalledReleaseVersion(version: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SEPARATELY_INSTALLED_RELEASE_VERSION_STORAGE_KEY,
    version
  );
}

export function usesSeparateApplicationInstall(
  provenance: AppBuildProvenance
): boolean {
  return provenance.installStrategy === "separateMacosApplication";
}

async function resolveAppBuildProvenance(): Promise<AppBuildProvenance> {
  const cached = store().get(appBuildProvenanceAtom);
  if (cached) return cached;
  const provenance = await getAppBuildProvenance();
  store().set(appBuildProvenanceAtom, provenance);
  return provenance;
}

function createCoordinator(): AppUpdaterCoordinator {
  return new AppUpdaterCoordinator({
    check: () => checkAppUpdateOnChannel(UPDATE_CHECK_TIMEOUT_MS),
    downloadTimeoutMs: UPDATE_DOWNLOAD_TIMEOUT_MS,
    getVersion,
    minCheckIntervalMs: FOREGROUND_CHECK_MIN_INTERVAL_MS,
    onStateChange: (state) => store().set(appUpdaterStateAtom, state),
  });
}

const coordinator = createCoordinator();
let activeAutomaticScheduler: AppUpdaterScheduler | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function getDownloadErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (/timed?\s*out|timeout/i.test(message)) {
    return "The download timed out. Check your network or proxy, then retry.";
  }
  return message;
}

function notifyCheckSuccess(
  update: Update | null,
  currentVersion: string | undefined,
  notify: boolean,
  provenance: AppBuildProvenance
): void {
  if (!notify) return;

  if (update) {
    Message.info({
      id: CHECK_TOAST_ID,
      title: "Update available",
      content: `Version ${update.version} is ready to install.`,
      duration: UPDATE_TOAST_DURATION_MS,
      action: {
        label: usesSeparateApplicationInstall(provenance)
          ? "Install official app"
          : "Update now",
        onClick: () => void installAvailableAppUpdate(),
      },
    });
    return;
  }

  Message.success({
    id: CHECK_TOAST_ID,
    content: currentVersion
      ? `ORGII is up to date (v${currentVersion}).`
      : "ORGII is up to date.",
    duration: UPDATE_TOAST_DURATION_MS,
  });
}

function notifyCheckFailure(error: unknown, notify: boolean): void {
  const message = getErrorMessage(error);
  log.warn("Update check failed", message);

  if (!notify) return;
  Message.error({
    id: CHECK_TOAST_ID,
    title: "Update check failed",
    content: message,
    duration: UPDATE_TOAST_DURATION_MS,
  });
}

export async function checkForAppUpdates(
  options: CheckForAppUpdatesOptions = {}
): Promise<Update | null> {
  const { notify = false, force = false } = options;

  if (notify) {
    Message.info({
      id: CHECK_TOAST_ID,
      content: "Checking for updates…",
      duration: 0,
    });
  }

  try {
    const result = await coordinator.checkForUpdate(force);
    const provenance = await resolveAppBuildProvenance();
    if (
      result.update &&
      usesSeparateApplicationInstall(provenance) &&
      getSeparatelyInstalledReleaseVersion() === result.update.version
    ) {
      coordinator.clearAvailableUpdate();
      if (notify) {
        Message.success({
          id: CHECK_TOAST_ID,
          content: `Official ORGII v${result.update.version} is already installed in /Applications.`,
          duration: UPDATE_TOAST_DURATION_MS,
        });
      }
      return null;
    }
    notifyCheckSuccess(
      result.update,
      result.currentVersion,
      notify,
      provenance
    );
    return result.update;
  } catch (error) {
    // A manual check is an explicit freshness request. Do not keep showing an
    // update that this check could not confirm. Silent failures keep the last
    // successful result so transient network loss does not erase UI state.
    if (notify) coordinator.clearAvailableUpdate();
    notifyCheckFailure(error, notify);
    return notify ? null : coordinator.getAvailableUpdate();
  }
}

export async function checkForUpdatesManually(): Promise<Update | null> {
  return checkForAppUpdates({ notify: true, force: true });
}

function createProgressReporter(): (event: DownloadEvent) => void {
  let lastReportedAt = 0;
  let downloaded = 0;
  let total: number | null = null;

  return (event) => {
    if (event.event === "Started") {
      downloaded = 0;
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }

    const now = Date.now();
    const shouldReport =
      event.event !== "Progress" ||
      now - lastReportedAt >= DOWNLOAD_PROGRESS_UPDATE_MIN_INTERVAL_MS;
    if (!shouldReport) return;

    lastReportedAt = now;
    const previous = store().get(appUpdateDownloadProgressAtom);
    const percent =
      event.event === "Finished"
        ? 100
        : total
          ? Math.min(100, Math.round((downloaded / total) * 100))
          : null;
    const progress: AppUpdateDownloadProgress = {
      active: true,
      collapsed: previous.collapsed,
      downloadedBytes: downloaded,
      totalBytes: total,
      percent,
    };
    setDownloadProgress(progress);
    if (!progress.collapsed) showDownloadProgressNotice(progress);
  };
}

async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

export interface InstallAvailableAppUpdateOptions {
  confirmed?: boolean;
  silentDownload?: boolean;
}

async function prepareAvailableAppUpdate(
  update: Update,
  options: {
    silentDownload: boolean;
    promptPolicy: "always" | "respect-reminder";
  }
): Promise<void> {
  const provenance = await resolveAppBuildProvenance();
  const progressReporter = options.silentDownload
    ? undefined
    : createProgressReporter();
  clearSkippedUpdateVersion(update.version);

  if (usesSeparateApplicationInstall(provenance)) {
    if (
      options.promptPolicy === "always" ||
      !isUpdateReminderDeferred(update.version)
    ) {
      store().set(appUpdateInstallPromptAtom, true);
    }
    return;
  }

  if (progressReporter) beginDownloadProgress();

  try {
    await coordinator.downloadAvailableUpdate(progressReporter);
    endDownloadProgress();
    if (
      options.promptPolicy === "always" ||
      !isUpdateReminderDeferred(update.version)
    ) {
      store().set(appUpdateInstallPromptAtom, true);
    }
  } catch (error) {
    if (progressReporter) endDownloadProgress();
    throw error;
  }
}

let pendingSeparateApplicationInstall: Promise<void> | null = null;

async function installOfficialApplicationBesideLocal(
  update: Update
): Promise<void> {
  if (pendingSeparateApplicationInstall) {
    await pendingSeparateApplicationInstall;
    return;
  }

  const operation = (async () => {
    store().set(separateAppUpdateInstallingAtom, true);
    beginDownloadProgress();
    try {
      const result = await installAppUpdateSeparately(
        update,
        createProgressReporter()
      );
      endDownloadProgress();
      setSeparatelyInstalledReleaseVersion(result.version);
      coordinator.clearAvailableUpdate();
      Message.success({
        id: INSTALL_TOAST_ID,
        title: "Official app installed",
        content: `${result.version} is installed at ${result.targetPath}. This local build is still running and unchanged.`,
        duration: 6000,
      });
    } catch (error) {
      endDownloadProgress();
      throw error;
    } finally {
      store().set(separateAppUpdateInstallingAtom, false);
    }
  })();

  pendingSeparateApplicationInstall = operation;
  try {
    await operation;
  } finally {
    if (pendingSeparateApplicationInstall === operation) {
      pendingSeparateApplicationInstall = null;
    }
  }
}

function showDownloadFailure(
  error: unknown,
  options: { automatic: boolean; retry: () => void }
): void {
  const errorContent = getDownloadErrorMessage(error);
  Message.error({
    id: INSTALL_TOAST_ID,
    title: "Update download failed",
    content: options.automatic
      ? `${errorContent} ORGII will retry in the background with increasing delays.`
      : errorContent,
    duration: 0,
    cancel: {
      label: options.automatic ? "Retry now" : "Retry",
      onClick: options.retry,
      closeOnClick: false,
    },
  });
}

export async function installAvailableAppUpdate(
  options: InstallAvailableAppUpdateOptions = {}
): Promise<void> {
  const { confirmed = false, silentDownload = false } = options;
  const update =
    coordinator.getAvailableUpdate() ?? (await checkForUpdatesManually());
  if (!update) return;

  if (confirmed) clearDeferredUpdateReminder(update.version);

  if (!confirmed) {
    try {
      await prepareAvailableAppUpdate(update, {
        silentDownload,
        promptPolicy: "always",
      });
      activeAutomaticScheduler?.resetRetry();
    } catch (error) {
      showDownloadFailure(error, {
        automatic: false,
        retry: () => void installAvailableAppUpdate({ silentDownload }),
      });
      log.error("Update download failed", error);
    }
    return;
  }

  try {
    const provenance = await resolveAppBuildProvenance();
    if (usesSeparateApplicationInstall(provenance)) {
      await installOfficialApplicationBesideLocal(update);
      return;
    }
    if (provenance.installStrategy === "unavailable") {
      throw new Error(
        "This local build cannot safely install a published release on this platform."
      );
    }

    Message.info({
      id: INSTALL_TOAST_ID,
      title: "Installing update",
      content: `Preparing v${update.version}…`,
      duration: 0,
    });

    const installed = await coordinator.installAvailableUpdate();
    if (!installed) return;

    Message.success({
      id: INSTALL_TOAST_ID,
      title: "Update installed",
      content: "Restarting ORGII to finish the update.",
      duration: 2500,
    });
    await relaunchApp();
  } catch (error) {
    Message.error({
      id: INSTALL_TOAST_ID,
      title: "Update install failed",
      content: getErrorMessage(error),
      duration: 6000,
    });
    log.error("Update install failed", error);
  }
}

async function executeAutomaticUpdate(
  reason: AutomaticUpdateReason,
  scheduler: AppUpdaterScheduler
): Promise<void> {
  let update: Update | null;
  try {
    const cachedRetryUpdate =
      reason === "retry" ? coordinator.getAvailableUpdate() : null;
    update =
      cachedRetryUpdate ??
      (
        await coordinator.checkForUpdate(
          reason === "startup" || reason === "interval" || reason === "retry"
        )
      ).update;
  } catch (error) {
    log.warn(
      `Automatic update check (${reason}) failed`,
      getErrorMessage(error)
    );
    throw error;
  }

  if (!update) {
    return;
  }
  if (getSkippedUpdateVersion() === update.version) {
    coordinator.clearAvailableUpdate();
    return;
  }

  const provenance = await resolveAppBuildProvenance();
  if (
    usesSeparateApplicationInstall(provenance) &&
    getSeparatelyInstalledReleaseVersion() === update.version
  ) {
    coordinator.clearAvailableUpdate();
    return;
  }

  try {
    // Installing can terminate the app on Windows. Every automatic path only
    // prepares the package and asks the user before installing or relaunching.
    await prepareAvailableAppUpdate(update, {
      silentDownload: true,
      promptPolicy: "respect-reminder",
    });
  } catch (error) {
    showDownloadFailure(error, {
      automatic: true,
      retry: () => scheduler.retryNow(),
    });
    log.warn(
      `Automatic update download (${reason}) failed`,
      getErrorMessage(error)
    );
    throw error;
  }
}

/** Only the mounted AppUpdater starts automatic work; importing actions is inert. */
export function startAutomaticAppUpdates(): () => void {
  let cancelled = false;
  let scheduler: AppUpdaterScheduler | null = null;
  void resolveAppBuildProvenance()
    .then(() => {
      if (cancelled) return;
      scheduler = new AppUpdaterScheduler({
        startupDelayMs: STARTUP_CHECK_DELAY_MS,
        intervalMs: UPDATE_CHECK_INTERVAL_MS,
        foregroundDebounceMs: FOREGROUND_EVENT_DEBOUNCE_MS,
        retryBaseDelayMs: UPDATE_RETRY_BASE_DELAY_MS,
        retryMaxDelayMs: UPDATE_RETRY_MAX_DELAY_MS,
        retryJitterRatio: UPDATE_RETRY_JITTER_RATIO,
      });
      activeAutomaticScheduler = scheduler;
      scheduler.start((reason) =>
        executeAutomaticUpdate(reason, scheduler as AppUpdaterScheduler)
      );
    })
    .catch((error) => {
      log.error("Cannot resolve app build provenance", error);
    });

  return () => {
    cancelled = true;
    scheduler?.stop();
    if (activeAutomaticScheduler === scheduler) {
      activeAutomaticScheduler = null;
    }
  };
}

export function postponeAppUpdate(version: string | undefined): void {
  if (version) deferUpdateReminder(version);
  store().set(appUpdateInstallPromptAtom, false);
}

export function skipAppUpdateVersion(version: string | undefined): void {
  if (version) {
    setSkippedUpdateVersion(version);
    clearDeferredUpdateReminder(version);
  }
  coordinator.clearAvailableUpdate();
}

/** Test-only reset for the module singleton. */
export function resetAppUpdaterForTests(): void {
  activeAutomaticScheduler?.stop();
  activeAutomaticScheduler = null;
  coordinator.reset();
  pendingSeparateApplicationInstall = null;
  resetAppBuildProvenanceForTests();
  store().set(appBuildProvenanceAtom, null);
  store().set(separateAppUpdateInstallingAtom, false);
  store().set(appUpdateInstallPromptAtom, false);
  setDownloadProgress(EMPTY_APP_UPDATE_DOWNLOAD_PROGRESS);
}
