// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import AskQuestionEvent from "../index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/config/toolIcons", () => ({
  getEventIcon: () => createElement("span", null, "question-icon"),
}));

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({
    replayEventById: vi.fn(),
    canReplay: false,
  }),
}));

vi.mock("@src/engines/SessionCore/rendering/registry", () => ({
  useLifecycleLabels: () => ({ running: "Waiting" }),
  useToolLabelText: () => "Answered",
}));

vi.mock("@src/engines/SessionCore/rendering/props", () => ({
  useNormalizedEventProps: (props: { event?: { id?: string } }) => ({
    eventId: props.event?.id,
    showActiveEventPainting: false,
  }),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("AskQuestionEvent collapse policy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("collapses the chat history body when a pending question is answered", () => {
    const pending = makeSessionEvent({
      id: "question-collapse-test",
      function: "ask_user_questions",
      args: { questions: [{ question: "Which branch?" }] },
      result: { status: "awaiting_user" },
      displayStatus: "running",
    });

    act(() => {
      root.render(createElement(AskQuestionEvent, { event: pending }));
    });

    const answered = {
      ...pending,
      displayStatus: "completed" as const,
      result: { status: "answered", answers: [["develop"]] },
    };

    act(() => {
      root.render(createElement(AskQuestionEvent, { event: answered }));
    });

    expect(container.textContent).toContain("Answered");
    expect(container.textContent).not.toContain("Which branch?");
    expect(container.textContent).not.toContain("develop");
  });
});
