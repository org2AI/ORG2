/**
 * useWebviewStyleEditor - Hook for live CSS editing in webviews
 *
 * Provides functionality to:
 * - Get full computed styles for the selected element
 * - Edit CSS properties with live updates
 * - Optimistic updates for responsive UI
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("useWebviewStyleEditor");

// ============================================
// Types
// ============================================

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FullComputedStyles {
  // Box model
  width: string;
  height: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;

  // Position
  position: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  zIndex: string;

  // Layout
  display: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  alignContent: string;
  flexWrap: string;
  gap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;

  // Typography
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textDecoration: string;
  color: string;

  // Background & Borders
  backgroundColor: string;
  backgroundImage: string;
  borderRadius: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomLeftRadius: string;
  borderBottomRightRadius: string;
  borderColor: string;
  borderStyle: string;
  boxShadow: string;

  // Effects
  opacity: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
  transform: string;
  transition: string;
  cursor: string;
  visibility: string;

  // Computed rect (actual position on screen)
  rect: ElementRect;
}

export interface UseWebviewStyleEditorOptions {
  /** Webview label to edit */
  webviewLabel: string;
  /** XPath of the selected element */
  selectedXPath: string | null;
  /** Whether the hook is enabled */
  enabled?: boolean;
}

export interface UseWebviewStyleEditorReturn {
  /** Full computed styles for the selected element */
  styles: FullComputedStyles | null;
  /** Whether styles are loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually refresh styles */
  refresh: () => Promise<void>;
  /** Set a CSS property value */
  setStyle: (property: string, value: string) => Promise<boolean>;
  /** Whether a style update is pending */
  isPending: boolean;
}

// ============================================
// Hook
// ============================================

export function useWebviewStyleEditor(
  options: UseWebviewStyleEditorOptions
): UseWebviewStyleEditorReturn {
  const { webviewLabel, selectedXPath, enabled = true } = options;

  const [styles, setStyles] = useState<FullComputedStyles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Fetch computed styles
  const refresh = useCallback(async () => {
    if (!webviewLabel || !selectedXPath || !enabled) {
      setStyles(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invoke<FullComputedStyles | null>(
        "get_element_computed_styles",
        { label: webviewLabel }
      );

      setStyles(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[useWebviewStyleEditor] Failed to fetch styles:", message);
      setError(message);
      setStyles(null);
    } finally {
      setLoading(false);
    }
  }, [webviewLabel, selectedXPath, enabled]);

  // Fetch styles when selection changes
  useEffect(() => {
    if (enabled && webviewLabel && selectedXPath) {
      refresh();
    } else {
      setStyles(null);
    }
  }, [enabled, webviewLabel, selectedXPath, refresh]);

  // Set a single CSS property
  const setStyle = useCallback(
    async (property: string, value: string): Promise<boolean> => {
      if (!webviewLabel || !selectedXPath) return false;

      setIsPending(true);

      try {
        // Optimistic update
        setStyles((prev) => {
          if (!prev) return prev;
          return { ...prev, [property]: value };
        });

        const success = await invoke<boolean>("set_element_style", {
          label: webviewLabel,
          xpath: selectedXPath,
          property,
          value,
        });

        if (success) {
          // Refresh to get accurate computed values (may differ from set value)
          // Use a small delay to let the browser recompute
          setTimeout(() => {
            refresh();
          }, 50);
        }

        return success;
      } catch (err) {
        log.error("[useWebviewStyleEditor] Failed to set style:", err);
        // Revert optimistic update
        refresh();
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [webviewLabel, selectedXPath, refresh]
  );

  return {
    styles,
    loading,
    error,
    refresh,
    setStyle,
    isPending,
  };
}
