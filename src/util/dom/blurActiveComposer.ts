/**
 * Blur the active session composer when a primary click lands outside its
 * shell, releasing both DOM focus and WebKit's retained editing selection.
 */

interface BackgroundMouseDownEvent {
  button: number;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

const COMPOSER_EDITOR_SELECTOR =
  '.composer-input-content[contenteditable="true"]';

function isComposerEditor(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement && element.matches(COMPOSER_EDITOR_SELECTOR)
  );
}

export function blurActiveComposerOnBackgroundMouseDown(
  event: BackgroundMouseDownEvent,
  editor: Element | null = document.activeElement
): void {
  if (event.button !== 0 || event.defaultPrevented) return;

  const target = event.target;
  if (
    !isComposerEditor(editor) ||
    !editor.isConnected ||
    !(target instanceof Node)
  )
    return;
  const scope = editor.closest("[data-composer-focus-scope]") ?? editor;
  if (scope.contains(target)) return;

  if (editor.ownerDocument.activeElement === editor) editor.blur();
  // WebKit retains a contenteditable selection after blur. On non-selectable
  // app chrome the click does not move it, and the next keystroke focuses the
  // editor again and inserts into the old range. Release only this composer's
  // selection; a selection the user made elsewhere must remain intact.
  const selection = editor.ownerDocument.getSelection();
  if (
    selection?.anchorNode &&
    selection.focusNode &&
    editor.contains(selection.anchorNode) &&
    editor.contains(selection.focusNode)
  ) {
    selection.removeAllRanges();
  }
}

/**
 * Capture also sees events stopped by descendants. Defer to the next task:
 * browsers can run a microtask between native event listeners, before a
 * descendant calls preventDefault. Remember the original composer so a
 * native focus transfer cannot make us blur the newly focused input instead.
 */
export function installBlurActiveComposerOnBackgroundMouseDown(): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const handleMouseDown = (event: MouseEvent) => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
    const editor = document.activeElement;
    if (event.button !== 0 || !isComposerEditor(editor)) return;
    pending = setTimeout(() => {
      pending = undefined;
      blurActiveComposerOnBackgroundMouseDown(event, editor);
    }, 0);
  };

  window.addEventListener("mousedown", handleMouseDown, true);
  return () => {
    window.removeEventListener("mousedown", handleMouseDown, true);
    if (pending !== undefined) clearTimeout(pending);
  };
}
