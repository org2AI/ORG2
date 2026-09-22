import { matchesShortcut } from "@src/config/keyboard/shortcutBindings";

export type FindScope = "session" | "file";
export interface FindTarget {
  scope: FindScope;
  element: () => HTMLElement | null;
  open: () => void;
  close: () => void;
}

const targets = new Set<FindTarget>();
const listeners = new Set<() => void>();
let active: FindTarget | null = null;
let focused: FindTarget | null = null;
const lastFocused: Partial<Record<FindScope, FindTarget>> = {};
let switched = false;
let revision = 0;
let scopes: Record<FindScope, boolean> = { session: false, file: false };
function notify() {
  scopes = {
    session: Boolean(otherTarget("session")),
    file: Boolean(otherTarget("file")),
  };
  revision++;
  listeners.forEach((listener) => listener());
}
export const subscribeFind = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getFindRevision = () => revision;
/** Window chrome yields to either active Find scope without subscribing to draft input. */
export const getFindOpen = () => active !== null;
function available(target: FindTarget) {
  const element = target.element();
  return Boolean(
    element?.isConnected &&
    !element.closest('[aria-hidden="true"], [hidden]') &&
    element.getClientRects().length
  );
}
function selectable(target: FindTarget) {
  return (
    available(target) &&
    (target.scope === "session" ||
      Boolean(target.element()?.closest('[data-find-scope-switching="true"]')))
  );
}
function otherTarget(scope: FindScope) {
  const preferred = lastFocused[scope];
  if (preferred && targets.has(preferred) && selectable(preferred))
    return preferred;
  return [...targets]
    .reverse()
    .find((target) => target.scope === scope && selectable(target));
}
export function canSelectFindScope(scope: FindScope) {
  return scopes[scope];
}
export function adoptFindTarget(target: FindTarget) {
  if (active === target) return;
  const previous = active;
  active = target;
  switched = false;
  previous?.close();
  notify();
}
export function closeFindTarget(target: FindTarget) {
  if (active !== target) return;
  active = null;
  switched = false;
  notify();
}
export function selectFindScope(scope: FindScope) {
  const next = otherTarget(scope);
  if (
    !next ||
    next === active ||
    !otherTarget("session") ||
    !otherTarget("file")
  )
    return;
  const previous = active;
  active = next;
  switched = true;
  previous?.close();
  next.open();
  notify();
}
/**
 * Opens the `scope` target nearest `anchor` — for menu entries that sit in a
 * pane header outside the searchable surface. Returns false when none is visible.
 */
export function openFindTargetNear(anchor: Element | null, scope: FindScope) {
  let owner: FindTarget | undefined;
  for (let node = anchor; node && !owner; node = node.parentElement) {
    const container = node;
    owner = [...targets].reverse().find((target) => {
      const element = target.element();
      return (
        target.scope === scope &&
        !!element &&
        container.contains(element) &&
        available(target)
      );
    });
  }
  if (!owner) return false;
  const previous = active;
  active = owner;
  switched = false;
  if (previous !== owner) previous?.close();
  owner.open();
  notify();
  return true;
}
function onInteraction(event: Event) {
  if (!(event.target instanceof Node)) return;
  if (
    event.target instanceof Element &&
    event.target.closest("[data-find-card]")
  )
    return;
  const containing = [...targets].filter((target) =>
    target.element()?.contains(event.target as Node)
  );
  // An editor can be nested in a session panel. The narrower file owns focus.
  focused =
    containing.find((target) => target.scope === "file") ??
    containing[0] ??
    null;
  if (focused) lastFocused[focused.scope] = focused;
  notify();
}
function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || !matchesShortcut(event, "find")) return;
  // Find is window-wide: toolbar, composer and station focus must not make
  // the shortcut disappear. Prefer the focused engine, then the open card,
  // then session search or a standalone visible editor.
  const owner =
    (focused && available(focused) ? focused : null) ??
    (active && available(active) ? active : null) ??
    otherTarget("session") ??
    [...targets]
      .reverse()
      .find((target) => target.scope === "file" && available(target));
  if (!owner) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (!active) {
    active = owner;
    switched = false;
    owner.open();
  } else {
    const next = otherTarget(active.scope === "session" ? "file" : "session");
    if (!switched && next && otherTarget("session") && otherTarget("file")) {
      selectFindScope(next.scope);
      return;
    }
    const previous = active;
    active = null;
    switched = false;
    previous.close();
  }
  notify();
}
export function registerFindTarget(target: FindTarget) {
  targets.add(target);
  // Watch only layout attributes on this target's ancestors. No subtree scan,
  // polling, or draft-input observation is needed to refresh scope availability.
  const layoutObserver = new MutationObserver(notify);
  for (
    let ancestor = target.element()?.parentElement;
    ancestor && ancestor !== document.body;
    ancestor = ancestor.parentElement
  ) {
    layoutObserver.observe(ancestor, {
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "hidden",
        "class",
        "style",
        "data-find-scope-switching",
      ],
    });
  }
  // CodeMirror registers while its DOM may still be detached. The layout is
  // also observed directly so maximizing chat still invalidates that target.
  document.querySelectorAll("[data-workbench-surface]").forEach((surface) => {
    layoutObserver.observe(surface, {
      attributes: true,
      attributeFilter: ["aria-hidden", "data-find-scope-switching"],
    });
  });
  if (targets.size === 1) {
    window.addEventListener("pointerdown", onInteraction, true);
    window.addEventListener("focusin", onInteraction, true);
    window.addEventListener("keydown", onKeyDown, true);
  }
  if (target.element()?.contains(document.activeElement)) focused = target;
  notify();
  return () => {
    layoutObserver.disconnect();
    targets.delete(target);
    if (focused === target) focused = null;
    if (lastFocused[target.scope] === target) delete lastFocused[target.scope];
    closeFindTarget(target);
    if (!targets.size) {
      window.removeEventListener("pointerdown", onInteraction, true);
      window.removeEventListener("focusin", onInteraction, true);
      window.removeEventListener("keydown", onKeyDown, true);
    }
    notify();
  };
}
