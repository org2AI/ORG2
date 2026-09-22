/**
 * CodeMirror Minimap Extension
 *
 * Canvas-based minimap renderer showing a scaled-down overview of the document.
 * Features:
 * - Canvas-based rendering for performance (no nested CodeMirror)
 * - Viewport indicator showing visible region
 * - Click to navigate
 * - Scroll synchronization
 * - Syntax-aware coloring
 *
 * Performance:
 * - updateViewport() is ALWAYS deferred to rAF so layout reads never
 *   run synchronously inside CM6's update() cycle (which would force
 *   the browser to resolve all pending DOM changes mid-update, causing
 *   scroll jitter in WebKit/WKWebView).
 * - Host height is cached via ResizeObserver to avoid getBoundingClientRect()
 *   on every scroll frame.
 * - Viewport indicator uses CSS transform (GPU-composited) instead of `top`.
 */
import { syntaxTree } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { RefObject } from "react";

/** Line height in pixels for minimap rendering */
const MINIMAP_LINE_HEIGHT = 2;
/** Padding at top and bottom of minimap content */
const MINIMAP_PADDING = 4;
/** Buffer above/below the host so small scrolls reuse the current drawing. */
const MINIMAP_OVERSCAN = 128;

/**
 * Creates a minimap extension using a canvas-based renderer.
 * The minimap shows a scaled-down overview of the document with a viewport indicator.
 *
 * IMPORTANT: The minimap host element must be a SIBLING of the editor, not inside it.
 *
 * @param hostRef - Ref to the minimap host element
 */
export function minimapExtension(
  hostRef: RefObject<HTMLElement | null>
): Extension {
  return ViewPlugin.fromClass(
    class {
      host: HTMLElement | null = null;
      canvas: HTMLCanvasElement | null = null;
      viewport: HTMLDivElement | null = null;
      mainView: EditorView;
      initialized = false;
      clickHandler: ((event: MouseEvent) => void) | null = null;
      dragHandler: ((event: MouseEvent) => void) | null = null;
      dragEndHandler: (() => void) | null = null;
      scrollHandler: (() => void) | null = null;
      initRafId = 0;
      scrollRafId = 0;
      needsRender = true;
      contentOffset = 0;
      canvasOffset = 0;
      canvasHeight = 0;
      viewportTop = 0;
      viewportHeight = 0;
      dragStartY = 0;
      dragStartScroll = 0;
      dragScrollScale = 0;
      wheelHandler: ((event: WheelEvent) => void) | null = null;
      visibilityHandler: (() => void) | null = null;
      destroyed = false;
      isDragging = false;
      cachedHostHeight = 0;
      resizeObserver: ResizeObserver | null = null;

      constructor(mainView: EditorView) {
        this.mainView = mainView;
        this.initRafId = requestAnimationFrame(() => this.tryInitialize());
      }

      tryInitialize() {
        if (this.destroyed || this.initialized) return;

        this.host = hostRef.current;
        if (!this.host) {
          return;
        }

        this.initialized = true;

        // Clear any existing elements (in case of reinitialization)
        const existingCanvas = this.host.querySelector(".minimap-canvas");
        const existingViewport = this.host.querySelector(".minimap-viewport");
        if (existingCanvas) existingCanvas.remove();
        if (existingViewport) existingViewport.remove();

        // Create canvas for code rendering
        this.canvas = document.createElement("canvas");
        this.canvas.className = "minimap-canvas";
        this.canvas.width = this.canvas.height = 0;
        this.host.appendChild(this.canvas);

        // Create viewport indicator
        this.viewport = document.createElement("div");
        this.viewport.className = "minimap-viewport";
        this.host.appendChild(this.viewport);

        // Cache host height via ResizeObserver to avoid getBoundingClientRect
        this.cachedHostHeight = this.host.clientHeight;
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            this.cachedHostHeight = entry.contentRect.height;
          }
          this.needsRender = true;
          this.scheduleViewportUpdate();
        });
        this.resizeObserver.observe(this.host);

        // Set up event handlers
        this.clickHandler = (event: MouseEvent) => this.handleClick(event);
        this.dragHandler = (event: MouseEvent) => this.handleDrag(event);
        this.dragEndHandler = () => this.handleDragEnd();

        this.host.addEventListener("mousedown", this.clickHandler);
        this.wheelHandler = (event) => {
          if (event.ctrlKey) return;
          event.preventDefault();
          const scroller = this.mainView.scrollDOM;
          const unit =
            event.deltaMode === 1
              ? this.mainView.defaultLineHeight
              : event.deltaMode === 2
                ? scroller.clientHeight
                : 1;
          scroller.scrollTop += event.deltaY * unit;
          this.scheduleViewportUpdate();
        };
        this.host.addEventListener("wheel", this.wheelHandler, {
          passive: false,
        });
        this.visibilityHandler = () => {
          if (document.hidden) {
            cancelAnimationFrame(this.scrollRafId);
            this.scrollRafId = 0;
            this.handleDragEnd();
            this.releaseCanvas();
          } else {
            this.needsRender = true;
            this.scheduleViewportUpdate();
          }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);

        this.scrollHandler = () => {
          this.scheduleViewportUpdate();
        };
        this.mainView.scrollDOM.addEventListener("scroll", this.scrollHandler, {
          passive: true,
        });

        // Initial render
        this.scheduleViewportUpdate();
      }

      scheduleViewportUpdate() {
        if (this.destroyed || document.hidden || this.scrollRafId) return;
        this.scrollRafId = requestAnimationFrame(() => {
          this.scrollRafId = 0;
          if (this.destroyed || document.hidden) return;
          this.updateViewport();
          const visibleBottom = Math.min(
            this.getContentHeight() + MINIMAP_PADDING * 2,
            this.contentOffset + this.cachedHostHeight
          );
          if (
            this.needsRender ||
            this.contentOffset < this.canvasOffset ||
            visibleBottom > this.canvasOffset + this.canvasHeight
          ) {
            this.renderMinimap();
          }
          if (this.canvas) {
            this.canvas.style.transform = `translateY(${this.canvasOffset - this.contentOffset}px)`;
          }
        });
      }

      handleClick(event: MouseEvent) {
        if (!this.host || event.button !== 0) return;
        event.preventDefault();
        const y = event.clientY - this.host.getBoundingClientRect().top;
        const insideSlider =
          y >= this.viewportTop && y <= this.viewportTop + this.viewportHeight;
        if (!insideSlider) {
          const lineNumber = Math.max(
            1,
            Math.min(
              this.mainView.state.doc.lines,
              Math.floor(
                (y - MINIMAP_PADDING + this.contentOffset) / MINIMAP_LINE_HEIGHT
              ) + 1
            )
          );
          const line = this.mainView.state.doc.line(lineNumber);
          const block = this.mainView.lineBlockAt(line.from);
          this.mainView.scrollDOM.scrollTop = Math.max(
            0,
            this.mainView.documentTop -
              this.mainView.scrollDOM.getBoundingClientRect().top +
              this.mainView.scrollDOM.scrollTop +
              block.top -
              this.mainView.scrollDOM.clientHeight / 2
          );
        }
        this.isDragging = true;
        this.host.classList.add("minimap-dragging");
        this.dragStartY = event.clientY;
        this.dragStartScroll = this.mainView.scrollDOM.scrollTop;
        const travel =
          Math.min(
            this.cachedHostHeight - MINIMAP_PADDING * 2,
            this.getContentHeight()
          ) - this.viewportHeight;
        this.dragScrollScale =
          travel > 0
            ? Math.max(
                0,
                this.mainView.scrollDOM.scrollHeight -
                  this.mainView.scrollDOM.clientHeight
              ) / travel
            : 0;
        document.addEventListener("mousemove", this.dragHandler!);
        document.addEventListener("mouseup", this.dragEndHandler!);
        window.addEventListener("blur", this.dragEndHandler!);
        this.scheduleViewportUpdate();
      }

      handleDrag(event: MouseEvent) {
        if (!this.isDragging) return;
        this.mainView.scrollDOM.scrollTop = Math.max(
          0,
          this.dragStartScroll +
            (event.clientY - this.dragStartY) * this.dragScrollScale
        );
        this.scheduleViewportUpdate();
      }

      handleDragEnd() {
        this.isDragging = false;
        this.host?.classList.remove("minimap-dragging");
        if (this.dragHandler)
          document.removeEventListener("mousemove", this.dragHandler);
        if (this.dragEndHandler) {
          document.removeEventListener("mouseup", this.dragEndHandler);
          window.removeEventListener("blur", this.dragEndHandler);
        }
      }

      getContentHeight(): number {
        const totalLines = this.mainView.state.doc.lines;
        return totalLines * MINIMAP_LINE_HEIGHT;
      }

      getSyntaxColors(): Record<string, string> {
        const styles = getComputedStyle(this.mainView.dom);
        const readToken = (name: string, fallback: string) => {
          const value = styles.getPropertyValue(name).trim();
          return value || fallback;
        };

        return {
          keyword: readToken("--cm-syntax-keyword", "#d73a49"),
          string: readToken("--cm-syntax-string", "#032f62"),
          comment: readToken("--cm-syntax-comment", "#6a737d"),
          number: readToken("--cm-syntax-number", "#005cc5"),
          function: readToken("--cm-syntax-function", "#6f42c1"),
          variable: readToken("--cm-syntax-variable", "#005cc5"),
          type: readToken("--cm-syntax-type", "#d73a49"),
          operator: readToken("--cm-syntax-operator", "#005cc5"),
          property: readToken("--cm-syntax-property", "#6f42c1"),
          default: readToken("--cm-editor-gutter-fg", "#6e7781"),
        };
      }

      getTokenColor(nodeType: string, colors: Record<string, string>): string {
        const typeLower = nodeType.toLowerCase();

        if (
          typeLower.includes("keyword") ||
          typeLower.includes("control") ||
          typeLower.includes("modifier")
        ) {
          return colors.keyword;
        }
        if (typeLower.includes("string") || typeLower.includes("template")) {
          return colors.string;
        }
        if (
          typeLower.includes("comment") ||
          typeLower.includes("blockcomment") ||
          typeLower.includes("linecomment")
        ) {
          return colors.comment;
        }
        if (
          typeLower.includes("number") ||
          typeLower.includes("integer") ||
          typeLower.includes("float")
        ) {
          return colors.number;
        }
        if (
          typeLower.includes("function") ||
          typeLower.includes("method") ||
          typeLower.includes("call")
        ) {
          return colors.function;
        }
        if (
          typeLower.includes("variable") ||
          typeLower.includes("identifier")
        ) {
          return colors.variable;
        }
        if (
          typeLower.includes("type") ||
          typeLower.includes("class") ||
          typeLower.includes("interface")
        ) {
          return colors.type;
        }
        if (
          typeLower.includes("operator") ||
          typeLower.includes("punctuation")
        ) {
          return colors.operator;
        }
        if (typeLower.includes("property")) {
          return colors.property;
        }

        return colors.default;
      }

      releaseCanvas() {
        if (this.canvas) this.canvas.width = this.canvas.height = 0;
        this.canvasHeight = 0;
        this.needsRender = true;
      }

      renderMinimap() {
        if (!this.canvas || !this.host) return;

        const hostRect = this.host.getBoundingClientRect();
        const width = hostRect.width;
        if (width === 0 || hostRect.height === 0) {
          this.releaseCanvas();
          return;
        }
        // Backing pixels and paint work depend on panel size, not file length.
        // Align the window to rows to preserve the original raster positions.
        const fullHeight = this.getContentHeight() + MINIMAP_PADDING * 2;
        const height = Math.min(
          fullHeight,
          Math.ceil(hostRect.height / MINIMAP_LINE_HEIGHT) *
            MINIMAP_LINE_HEIGHT +
            MINIMAP_OVERSCAN * 2
        );
        this.canvasHeight = height;
        this.canvasOffset = Math.max(
          0,
          Math.min(
            fullHeight - height,
            Math.floor(this.contentOffset / MINIMAP_LINE_HEIGHT) *
              MINIMAP_LINE_HEIGHT -
              MINIMAP_OVERSCAN
          )
        );
        this.needsRender = false;

        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.ceil(width * dpr);
        const pixelHeight = Math.ceil(height * dpr);
        // Assigning even an unchanged dimension reallocates/clears the canvas.
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight)
          this.canvas.height = pixelHeight;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const colors = this.getSyntaxColors();
        const doc = this.mainView.state.doc;
        const totalLines = doc.lines;
        const tree = syntaxTree(this.mainView.state);

        const charWidth = 1;

        const firstLine = Math.max(
          1,
          Math.floor(
            (this.canvasOffset - MINIMAP_PADDING) / MINIMAP_LINE_HEIGHT
          ) + 1
        );
        const lastLine = Math.min(
          totalLines,
          Math.ceil(
            (this.canvasOffset + height - MINIMAP_PADDING) / MINIMAP_LINE_HEIGHT
          )
        );
        const maxColumns = Math.ceil(width / charWidth);
        for (let lineNum = firstLine; lineNum <= lastLine; lineNum++) {
          const line = doc.line(lineNum);
          // Bound work for very long lines and keep tabs aligned with editor columns.
          const lineText = doc.sliceString(
            line.from,
            Math.min(line.to, line.from + maxColumns)
          );
          const yPos =
            MINIMAP_PADDING +
            (lineNum - 1) * MINIMAP_LINE_HEIGHT -
            this.canvasOffset;

          if (lineText.trim().length === 0) continue;

          interface TokenSpan {
            start: number;
            end: number;
            color: string;
          }
          const tokens: TokenSpan[] = [];

          tree.iterate({
            from: line.from,
            to: Math.min(line.to, line.from + maxColumns),
            enter: (node) => {
              if (node.node.firstChild) return;

              const nodeStart = Math.max(node.from, line.from);
              const nodeEnd = Math.min(node.to, line.from + maxColumns);

              if (nodeStart < nodeEnd) {
                const color = this.getTokenColor(node.name, colors);
                tokens.push({
                  start: nodeStart - line.from,
                  end: nodeEnd - line.from,
                  color,
                });
              }
            },
          });

          let column = 0;
          let tokenIndex = 0;
          for (
            let index = 0;
            index < lineText.length && column < maxColumns;
            index++
          ) {
            const char = lineText[index];
            if (char === "\t") {
              column +=
                this.mainView.state.tabSize -
                (column % this.mainView.state.tabSize);
              continue;
            }
            if (char.trim()) {
              // Leaf spans arrive in document order; scan them once per row.
              while (
                tokenIndex < tokens.length &&
                tokens[tokenIndex].end <= index
              )
                tokenIndex++;
              const token = tokens[tokenIndex];
              ctx.fillStyle =
                token && token.start <= index ? token.color : colors.default;
              ctx.fillRect(4 + column * charWidth, yPos, charWidth * 0.75, 1);
            }
            column++;
          }
        }
      }

      updateViewport() {
        if (!this.viewport) return;

        const scroller = this.mainView.scrollDOM;
        const totalLines = this.mainView.state.doc.lines;
        const contentHeight = this.getContentHeight();
        const hostHeight = this.cachedHostHeight;

        if (totalLines === 0 || contentHeight === 0 || hostHeight <= 0) {
          this.viewport.style.display = "none";
          return;
        }

        this.viewport.style.display = "block";

        const scrollTop = scroller.scrollTop;
        const scrollHeight = scroller.scrollHeight;
        const clientHeight = scroller.clientHeight;

        // Project actual CodeMirror blocks, including wrapped lines and folds,
        // into the same logical-line coordinates used by the canvas.
        const projectHeight = (height: number) => {
          const block = this.mainView.lineBlockAtHeight(Math.max(0, height));
          const first = this.mainView.state.doc.lineAt(block.from).number - 1;
          const last = this.mainView.state.doc.lineAt(block.to).number;
          const fraction = Math.max(
            0,
            Math.min(1, (height - block.top) / Math.max(1, block.height))
          );
          return (first + (last - first) * fraction) * MINIMAP_LINE_HEIGHT;
        };
        const documentScrollTop = scrollTop - this.mainView.documentPadding.top;
        const visibleStart = projectHeight(documentScrollTop);
        const visibleEnd = projectHeight(documentScrollTop + clientHeight);
        const scrollRatio = Math.max(
          0,
          Math.min(1, scrollTop / Math.max(1, scrollHeight - clientHeight))
        );
        const trackHeight = Math.max(
          0,
          Math.min(hostHeight - MINIMAP_PADDING * 2, contentHeight)
        );
        this.viewportHeight = Math.min(
          trackHeight,
          Math.max(20, visibleEnd - visibleStart)
        );
        const sliderStart = Math.min(
          visibleStart,
          contentHeight - this.viewportHeight
        );
        this.contentOffset = Math.max(
          0,
          Math.min(
            contentHeight - trackHeight,
            sliderStart - scrollRatio * (trackHeight - this.viewportHeight)
          )
        );
        this.viewportTop = MINIMAP_PADDING + sliderStart - this.contentOffset;
        this.viewport.style.transform = `translateY(${this.viewportTop}px)`;
        this.viewport.style.height = `${this.viewportHeight}px`;
      }

      update(update: ViewUpdate) {
        if (!this.initialized) {
          this.tryInitialize();
          return;
        }
        if (
          update.docChanged ||
          update.geometryChanged ||
          update.transactions.some((transaction) => transaction.reconfigured) ||
          update.startState.facet(EditorView.darkTheme) !==
            update.state.facet(EditorView.darkTheme) ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.needsRender = true;
        }
        if (this.needsRender || update.viewportChanged)
          this.scheduleViewportUpdate();
      }

      destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.initRafId);
        cancelAnimationFrame(this.scrollRafId);
        this.handleDragEnd();
        if (this.wheelHandler)
          this.host?.removeEventListener("wheel", this.wheelHandler);
        if (this.visibilityHandler)
          document.removeEventListener(
            "visibilitychange",
            this.visibilityHandler
          );
        this.resizeObserver?.disconnect();
        if (this.host && this.clickHandler) {
          this.host.removeEventListener("mousedown", this.clickHandler);
        }
        if (this.scrollHandler) {
          this.mainView.scrollDOM.removeEventListener(
            "scroll",
            this.scrollHandler
          );
        }
        this.releaseCanvas();
        this.canvas?.remove();
        this.viewport?.remove();
        this.canvas = null;
        this.viewport = null;
        this.initialized = false;
      }
    }
  );
}
