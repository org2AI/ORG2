/**
 * Where an inline expanded card is being rendered.
 *
 * `InlineInfoCard` was built for a table's expanded row, so it wraps its card
 * in a `<td>` shim — `w-0 min-w-full` (content cannot force the cell wider)
 * plus the row's own inset. A card grid gives its detail slot a bounded grid
 * track and its own spacing, so that shim is a dead layer there.
 *
 * The default stays `table-cell`: every existing caller keeps today's markup,
 * and only a container that knows better opts out.
 */
import React, { createContext, useContext } from "react";

export type InlineSurface = "table-cell" | "block";

const InlineSurfaceContext = createContext<InlineSurface>("table-cell");

export function useInlineSurface(): InlineSurface {
  return useContext(InlineSurfaceContext);
}

export function InlineSurfaceProvider({
  surface,
  children,
}: {
  surface: InlineSurface;
  children: React.ReactNode;
}) {
  return (
    <InlineSurfaceContext.Provider value={surface}>
      {children}
    </InlineSurfaceContext.Provider>
  );
}
