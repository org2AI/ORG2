/** Non-hook navigation adapter consumed by the mounted React Router owner. */
export function navigateApp(path: string, replace?: boolean): void {
  window.dispatchEvent(
    new CustomEvent("action-system-navigate", {
      detail: { path, ...(replace === undefined ? {} : { replace }) },
    })
  );
}
