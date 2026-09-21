import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VoiceRecordingBar from "./VoiceRecordingBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("VoiceRecordingBar", () => {
  it("names the add-content control when it is interactive", () => {
    const markup = renderToStaticMarkup(
      createElement(VoiceRecordingBar, {
        elapsedSeconds: 1,
        onAccept: vi.fn(),
        onAddContent: vi.fn(),
        onCancel: vi.fn(),
      })
    );

    expect(markup).toContain('aria-label="common:actions.add"');
    expect(markup).toContain('aria-hidden="false"');
  });

  it("keeps its controls on the composer toolbar band", () => {
    const markup = renderToStaticMarkup(
      createElement(VoiceRecordingBar, {
        elapsedSeconds: 1,
        onAccept: vi.fn(),
        onAddContent: vi.fn(),
        onCancel: vi.fn(),
      })
    );
    const rootClass = markup.match(/^<div class="([^"]*)"/)?.[1].split(" ");

    // Same geometry as the ComposerBar toolbar row, so + and ✓ sit where the
    // idle composer's + and send were when dictation starts.
    expect(rootClass).toEqual(expect.arrayContaining(["h-9", "pt-2"]));
    expect(rootClass?.some((name) => /^(p|px|pl|pr|pb|py)-/.test(name))).toBe(
      false
    );
  });
});
