import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { HoverCardPanel } from "@src/components/HoverCard/HoverCardBase";

import {
  getLoadedSessionHoverCardContent,
  loadSessionHoverCardContent,
} from "./loadSessionHoverCardContent";

type ContentComponent = NonNullable<
  ReturnType<typeof getLoadedSessionHoverCardContent>
>;
type ContentState =
  | { status: "loading" }
  | { status: "loaded"; Component: ContentComponent }
  | { status: "error" };

/** Mounted only by the visible hover portal; importing code never fetches a session. */
export function DeferredSessionHoverCardContent({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation("common");
  const [content, setContent] = useState<ContentState>(() => {
    const Component = getLoadedSessionHoverCardContent();
    return Component ? { status: "loaded", Component } : { status: "loading" };
  });

  useEffect(() => {
    if (content.status !== "loading") return;
    let active = true;
    void loadSessionHoverCardContent().then(
      (Component) => {
        if (active) setContent({ status: "loaded", Component });
      },
      () => {
        if (active) setContent({ status: "error" });
      }
    );
    return () => {
      active = false;
    };
  }, [content.status]);

  if (content.status === "loaded") {
    const { Component } = content;
    return <Component sessionId={sessionId} />;
  }

  const failed = content.status === "error";
  return (
    <HoverCardPanel>
      <div
        className="flex min-h-16 items-center text-sm text-text-3"
        role={failed ? "alert" : "status"}
      >
        {t(failed ? "errors.failedToLoad" : "actions.loading")}
      </div>
    </HoverCardPanel>
  );
}
