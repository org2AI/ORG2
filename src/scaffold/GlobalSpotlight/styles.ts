// ============ SPOTLIGHT STYLES ============
// CSS that cannot be expressed with Tailwind utility classes
// (animations, scrollbar styling, pseudo-selectors, third-party library overrides)

export const SPOTLIGHT_STYLES = `
  /* ========== SPOTLIGHT SHADOW ========== */
  .spotlight-shadow {
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3), 0 8px 20px rgba(0, 0, 0, 0.2);
  }

  /* ========== BACKDROP ========== */
  /* Light dim + blur so the page recedes behind the panel. Much softer than
   * the modal mask on purpose: spotlight is a quick palette, not a dialog. */
  .spotlight-backdrop {
    background: rgba(0, 0, 0, 0.16);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
    border-radius: var(--border-radius-window);
    animation: spotlight-backdrop-in 150ms ease-out;
  }

  @keyframes spotlight-backdrop-in {
    from { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .spotlight-backdrop { animation: none; }
  }

  /* ========== SCROLLBAR ========== */
  .spotlight-scrollable {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .spotlight-scrollable::-webkit-scrollbar { display: none; }

  @keyframes spotlight-refresh-rotate {
    to { transform: rotate(360deg); }
  }

  .spotlight-refresh-spin {
    animation: spotlight-refresh-rotate 300ms linear infinite;
  }

  /* ========== HOVER/SELECTION STATES ========== */
  /* 
   * .selected tracks the active item in both modes:
   * - Keyboard: arrow keys update selectedIndex
   * - Mouse: onMouseEnter updates selectedIndex
   * Single highlight via fill-2 background, no text color changes.
   */
  
  .spotlight-item.selected {
    background: var(--color-fill-2);
  }

  [data-keyboard-mode="false"] .spotlight-item:hover {
    background: var(--color-fill-2);
  }

  .spotlight-disclosure-chevron {
    width: 0;
    opacity: 0;
    transition: width 120ms ease, opacity 120ms ease;
  }

  .spotlight-item.selected .spotlight-disclosure-chevron,
  [data-keyboard-mode="false"] .spotlight-item:hover .spotlight-disclosure-chevron {
    width: 1rem;
    opacity: 1;
  }
`;
