/**
 * App lock input guard.
 *
 * The lock page is an opaque overlay, which stops the pointer but not the
 * keyboard: the app registers global shortcuts on `window`/`document`, and a
 * focused control behind the overlay would still take keystrokes. While the
 * guard is active it
 *
 * - marks every `document.body` child except the lock page `inert` (no focus,
 *   no clicks, hidden from assistive tech), including portals mounted later
 *   such as toasts and popovers, and
 * - swallows key events in the capture phase on `window` before any app
 *   shortcut handler can see them.
 *
 * The key listener is installed once at module load rather than from an
 * effect. Capture listeners on the same target run in registration order, and
 * several app handlers also capture on `window`; installing here — this module
 * is imported by `AppBootstrap`, before any component effect runs — is what
 * guarantees the guard is first in line.
 *
 * Inside the lock page key events are stopped too, which does not break the
 * form: typing, Tab and Enter-to-submit are default actions and the `input` /
 * `submit` events they produce are separate events that propagate normally.
 */

export const APP_LOCK_ROOT_ID = "app-lock-root";

const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;
const INERT_MARK = "data-app-lock-inert";

let guardActive = false;
let keyboardGuardInstalled = false;

function isInsideLockRoot(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  const root = document.getElementById(APP_LOCK_ROOT_ID);
  return root !== null && root.contains(target);
}

function handleKeyEvent(event: KeyboardEvent): void {
  if (!guardActive) return;
  event.stopImmediatePropagation();
  if (!isInsideLockRoot(event.target)) {
    event.preventDefault();
  }
}

function installKeyboardGuard(): void {
  if (keyboardGuardInstalled || typeof window === "undefined") return;
  keyboardGuardInstalled = true;
  for (const type of KEY_EVENTS) {
    window.addEventListener(type, handleKeyEvent, true);
  }
}

installKeyboardGuard();

function makeInert(element: Element): void {
  if (element.id === APP_LOCK_ROOT_ID) return;
  // Leave elements something else already made inert alone, so releasing the
  // guard does not re-enable them.
  if (element.hasAttribute("inert")) return;
  element.setAttribute("inert", "");
  element.setAttribute(INERT_MARK, "");
}

function releaseInert(): void {
  for (const element of document.querySelectorAll(`[${INERT_MARK}]`)) {
    element.removeAttribute("inert");
    element.removeAttribute(INERT_MARK);
  }
}

/**
 * Turn the guard on. Returns the function that turns it off; safe to call
 * from an effect (idempotent release).
 */
export function activateAppLockInputGuard(): () => void {
  guardActive = true;

  for (const child of Array.from(document.body.children)) {
    makeInert(child);
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) makeInert(node);
      }
    }
  });
  observer.observe(document.body, { childList: true });

  const active = document.activeElement;
  if (active instanceof HTMLElement && !isInsideLockRoot(active)) {
    active.blur();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    observer.disconnect();
    releaseInert();
    guardActive = false;
  };
}
