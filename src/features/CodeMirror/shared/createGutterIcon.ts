import type { IconSvgElement } from "@src/icons";

/** Render Hugeicons glyph data in CodeMirror-owned DOM without a React root. */
export function createGutterIcon(icon: IconSvgElement): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.cssText =
    "width: var(--cm-icon-size, 14px); height: var(--cm-icon-size, 14px); flex-shrink: 0;";
  for (const [tag, attributes] of icon) {
    const child = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "key") continue;
      child.setAttribute(
        name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        String(value)
      );
    }
    svg.appendChild(child);
  }
  return svg;
}
