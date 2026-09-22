import { useCallback, useRef } from "react";

export function useProgrammaticInputMutation() {
  const programmaticInputMutationDepthRef = useRef(0);

  const withProgrammaticInputMutation = useCallback((mutation: () => void) => {
    programmaticInputMutationDepthRef.current += 1;
    try {
      mutation();
    } finally {
      window.setTimeout(() => {
        programmaticInputMutationDepthRef.current = Math.max(
          0,
          programmaticInputMutationDepthRef.current - 1
        );
      }, 0);
    }
  }, []);

  return { programmaticInputMutationDepthRef, withProgrammaticInputMutation };
}
