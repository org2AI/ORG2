import { type ReactNode, createContext, useContext, useRef } from "react";

export interface ImageAttachmentTarget {
  signal: AbortSignal;
  add: (file: File, signal: AbortSignal) => Promise<number>;
  focus: () => void;
}

const ImageAttachmentContext = createContext<{
  current: ImageAttachmentTarget | null;
} | null>(null);

/** One target per chat surface; no global registry or transcript subscription. */
export function ImageActionsProvider({ children }: { children?: ReactNode }) {
  const target = useRef<ImageAttachmentTarget | null>(null);
  return (
    <ImageAttachmentContext.Provider value={target}>
      {children}
    </ImageAttachmentContext.Provider>
  );
}

export function useImageAttachmentTarget() {
  return useContext(ImageAttachmentContext);
}
