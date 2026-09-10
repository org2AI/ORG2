import { z } from "zod";

import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { navigateApp as appNavigate } from "@src/router/navigateApp";
import { NAV_DESTINATIONS } from "@src/scaffold/GlobalSpotlight/navDestinations";

function formatDestinationLabel(destinationId: string): string {
  return destinationId
    .replace(/^(nav|action)-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function actionIdForDestination(destinationId: string): string {
  return `spotlight.destination.${destinationId}`;
}

export const spotlightNavigationZodActions = NAV_DESTINATIONS.filter(
  (destination) => destination.searchable !== false
).map((destination) => {
  const label = formatDestinationLabel(destination.id);
  return defineZodAction(
    {
      id: actionIdForDestination(destination.id),
      category: "spotlight",
      description: `Open Spotlight destination: ${label}`,
      longDescription: `Navigate to the same page or wizard entry exposed in Spotlight for ${label}. Path: ${destination.path}`,
      params: z.object({}),
      layer: "gui",
      tags: [
        "spotlight",
        "navigation",
        "page",
        "wizard",
        destination.group,
        destination.id,
        destination.path,
        ...(destination.keywords ?? []),
      ],
      examples: [
        `open ${label}`,
        `go to ${label}`,
        ...(destination.keywords ?? []).map((keyword) => `open ${keyword}`),
      ],
    },
    async () => {
      appNavigate(destination.path);
      return {
        success: true,
        message: `Opened ${label}`,
      };
    }
  );
});

export const spotlightNavigationActionRegistration =
  defineAppActionRegistration(spotlightNavigationZodActions);
