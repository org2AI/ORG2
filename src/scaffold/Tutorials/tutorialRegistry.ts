import { CODE_EDITOR_TOUR_EVENT } from "./codeEditorTourConfig";
import { GENERAL_LAYOUT_TOUR_EVENT } from "./generalLayoutTourConfig";

export const TUTORIALS_OPEN_EVENT = "orgii:open-tutorials";

type TutorialId = "general-layout" | "code-editor";

export interface TutorialEntry {
  id: TutorialId;
  /** Stable English metadata exposed to agent actions; UI must use the keys. */
  title: string;
  description: string;
  durationLabel: string;
  titleKey: `tutorials.${"generalLayout" | "codeEditor"}.title`;
  descriptionKey: `tutorials.${"generalLayout" | "codeEditor"}.description`;
  durationKey: `tutorials.${"generalLayout" | "codeEditor"}.duration`;
  eventName: string;
}

export const TUTORIALS: TutorialEntry[] = [
  {
    id: "general-layout",
    title: "General layout tour",
    description:
      "Learn the Chat Panel, Runtime, station mode switcher, and dock.",
    durationLabel: "1 min",
    titleKey: "tutorials.generalLayout.title",
    descriptionKey: "tutorials.generalLayout.description",
    durationKey: "tutorials.generalLayout.duration",
    eventName: GENERAL_LAYOUT_TOUR_EVENT,
  },
  {
    id: "code-editor",
    title: "Code Editor tour",
    description:
      "Learn tabs, the editor workspace, Source Control, and Git History.",
    durationLabel: "2 min",
    titleKey: "tutorials.codeEditor.title",
    descriptionKey: "tutorials.codeEditor.description",
    durationKey: "tutorials.codeEditor.duration",
    eventName: CODE_EDITOR_TOUR_EVENT,
  },
];
