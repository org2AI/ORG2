import { defineTabFactory } from "../tabFactory";

/** Keep only the session reference; resource rows are read from durable history. */
const sessionSourcesTabFactory = defineTabFactory<{
  sessionId: string;
  title: string;
}>({
  tabType: "session-sources",
  idStrategy: {
    type: "keyed",
    prefix: "session-sources",
    getKey: ({ sessionId }) => sessionId,
  },
  getTitle: ({ title }) => title,
  icon: "Link",
});

export function createSessionSourcesTab(sessionId: string, title: string) {
  return sessionSourcesTabFactory({ sessionId, title });
}
