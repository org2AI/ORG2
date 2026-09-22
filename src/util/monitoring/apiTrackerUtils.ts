/**
 * Pure utility functions for API and Tauri call tracking.
 * Extracted from apiTracker.ts — no mutable state lives here.
 */
import { getLastHoveredElement } from "../core/error/componentIssueTracker/";

// ============================================================================
// Component info
// ============================================================================

/** Extract selector and label from the most recently hovered DOM element. */
export const getComponentInfo = () => {
  const element = getLastHoveredElement();
  if (!element) return { selector: undefined, label: undefined };

  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).filter(Boolean).slice(0, 3);
  const classStr = classes.length ? `.${classes.join(".")}` : "";
  const dataComponent = element.getAttribute("data-component");
  const componentStr = dataComponent ? ` [${dataComponent}]` : "";

  const selector = `${tagName}${id}${classStr}${componentStr}`;
  const label = dataComponent
    ? `data-component="${dataComponent}"`
    : element.id
      ? `id="${element.id}"`
      : classes.length
        ? `className="${classes.join(" ")}"`
        : `<${tagName}>`;

  return { selector, label };
};

// ============================================================================
// Stack filtering sets
// ============================================================================

/** React internal function names to skip in stack traces. */
export const INTERNAL_FUNCTIONS = new Set([
  "get",
  "set",
  "request",
  "promiseReactionJob",
  "mountReducer",
  "useReducer",
  "useAtomValue",
  "useAtom",
  "useSetAtom",
  "renderWithHooks",
  "react_stack_bottom_frame",
  "mountIndeterminateComponent",
  "beginWork$1",
  "performUnitOfWork",
  "workLoopSync",
  "renderRootSync",
  "performConcurrentWorkOnRoot",
  "workLoop",
  "flushWork",
  "performWorkUntilDeadline",
  "updateReducer",
  "rerenderReducer",
  // API layer functions to skip
  "getApi",
  "postApi",
  "putApi",
  "patchApi",
  "deleteApi",
  "makeRequest",
  "makeDeleteRequest",
]);

/** Tauri internal function names to skip in stack traces. */
export const TAURI_INTERNAL_FUNCTIONS = new Set([
  "invokeTauri",
  "invoke",
  "trackTauriInvoke",
  "patchedTauriInvoke",
  ...INTERNAL_FUNCTIONS,
]);

export const TIMER_INTERNAL_FUNCTIONS = new Set([
  "installTimerTracking",
  "captureTimerSource",
  "recordTimerFire",
  "wrappedCallback",
  "setInterval",
  "setTimeout",
  "requestAnimationFrame",
  "patchedSetInterval",
  "patchedSetTimeout",
  "patchedRequestAnimationFrame",
  ...INTERNAL_FUNCTIONS,
]);

// ============================================================================
// Stack trace parsers
// ============================================================================

function getFilteredStack(
  internalFunctions: Set<string>,
  ignoredSubstrings: string[]
): string {
  try {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");

    const relevantLines = lines
      .slice(2)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "@") return false;
        if (trimmed.includes("node_modules")) return false;
        if (
          ignoredSubstrings.some((substring) => trimmed.includes(substring))
        ) {
          return false;
        }

        const funcMatch = trimmed.match(/^(\w+)@/);
        if (funcMatch && internalFunctions.has(funcMatch[1])) return false;

        const chromeMatch = trimmed.match(/at\s+(\w+)\s*\(/);
        if (chromeMatch && internalFunctions.has(chromeMatch[1])) return false;

        return true;
      })
      .slice(0, 5)
      .map((line) => line.trim());

    return relevantLines.join("\n");
  } catch {
    return "";
  }
}

/** Capture and filter a stack trace for HTTP API calls. */
export const getApiStack = (): string =>
  getFilteredStack(INTERNAL_FUNCTIONS, ["apiTracker.ts"]);

/** Capture and filter a stack trace for Tauri invoke calls. */
export const getTauriStack = (): string =>
  getFilteredStack(TAURI_INTERNAL_FUNCTIONS, [
    "apiTracker.ts",
    "tauri/init.ts",
  ]);

/** Capture and filter a stack trace for timer/RAF creation sites. */
export const getTimerStack = (): string =>
  getFilteredStack(TIMER_INTERNAL_FUNCTIONS, ["apiTracker.ts"]);

// ============================================================================
// File info extraction
// ============================================================================

function extractFunctionNameFromStackLine(line: string): string | undefined {
  const safariMatch = line.match(/^(\w+)@/);
  if (safariMatch) return safariMatch[1];

  const chromeNameMatch = line.match(/at\s+(\w+)\s*\(/);
  if (chromeNameMatch) return chromeNameMatch[1];

  return undefined;
}

function extractSourceLocationFromStackLine(line: string) {
  const pathMatch = line.match(/(?:^|[/(])((?:src|app)\/[^:)]+):(\d+):\d+/);
  if (!pathMatch) return {};

  return {
    filePath: pathMatch[1],
    lineNumber: parseInt(pathMatch[2], 10),
  };
}

/** Parse file path, component name, function name, and line number from a stack trace. */
export const extractFileInfo = (stack: string) => {
  try {
    const lines = stack.split("\n");
    if (lines.length === 0) return {};

    for (const line of lines) {
      const trimmed = line.trim();
      const functionOrComponentName = extractFunctionNameFromStackLine(trimmed);
      const { filePath, lineNumber } =
        extractSourceLocationFromStackLine(trimmed);

      if (!functionOrComponentName && !filePath) continue;

      let componentName = functionOrComponentName;
      if (filePath) {
        const fileNameMatch = filePath.match(/\/([^/]+?)(?:\/index)?\.tsx?$/);
        if (fileNameMatch) componentName = fileNameMatch[1];
      }

      return {
        filePath,
        componentName,
        functionName: functionOrComponentName,
        lineNumber,
      };
    }

    return {};
  } catch {
    return {};
  }
};

// ============================================================================
// ID generation
// ============================================================================

/** Generate a unique request ID. */
export const generateRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
