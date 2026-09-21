/**
 * Guards the descriptor -> control mapping for the settings pane.
 *
 * The 16 `configs/*Config.tsx` components were replaced by one renderer over
 * `CHANNEL_SETTINGS_GROUPS`, so a wrong `kind` on a descriptor now silently
 * swaps a control (a `Switch` rendered as a text `Input`, a secret rendered in
 * the clear) for a whole channel. Row counts and label keys alone do not catch
 * that, which is what this test is for: it records the control each descriptor
 * renders, in order, and pins the two channels that exercise every kind.
 */
import { PassThrough } from "node:stream";
import { type ReactNode, createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ChannelConfigFields from "./ChannelConfigFields";
import { CHANNEL_TYPE } from "./types";

interface Rendered {
  control: string;
  label: string;
  password?: boolean;
}

const { rendered, state, leaf } = vi.hoisted(() => {
  const rendered: {
    control: string;
    label: string;
    password?: boolean;
  }[] = [];
  const state = { label: "" };
  return {
    rendered,
    state,
    leaf:
      (control: string) =>
      (props: Record<string, unknown>): null => {
        rendered.push({
          control,
          label: state.label,
          ...(props.type === "password" ? { password: true } : {}),
        });
        return null;
      },
  };
});

vi.mock("@/src/components/layout/Section", () => ({
  SECTION_CONTROL_STYLE: {},
  SectionContainer: ({ children }: { children?: ReactNode }) => children,
  SectionRow: ({
    label,
    children,
  }: {
    label?: string;
    children?: ReactNode;
  }) => {
    state.label = String(label ?? "");
    return children;
  },
}));
vi.mock("@src/components/Input", () => ({ default: leaf("Input") }));
vi.mock("@src/components/NumberInput", () => ({
  default: leaf("NumberInput"),
}));
vi.mock("@src/components/Select", () => ({ default: leaf("Select") }));
vi.mock("@src/components/Switch", () => ({ default: leaf("Switch") }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** SSR the renderer for one channel and return what each row rendered. */
async function renderChannel(channelType: string): Promise<Rendered[]> {
  rendered.length = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = renderToPipeableStream(
      createElement(ChannelConfigFields, {
        channelType,
        config: {},
        update: () => undefined,
        pathPrefix: "channels.matrix",
      }),
      {
        onAllReady: () => {
          stream.pipe(new PassThrough().on("finish", () => resolve()));
        },
        onShellError: reject,
      }
    );
  });
  return [...rendered];
}

describe("ChannelConfigFields", () => {
  it("renders matrix rows as the config component did", async () => {
    // Mirrors configs/MatrixConfig.tsx at 4e28ad56a2: six Inputs (two of them
    // password) around a Switch for encryption, allowFrom last.
    expect(await renderChannel(CHANNEL_TYPE.MATRIX)).toEqual([
      { control: "Input", label: "channels.matrixHomeserver" },
      { control: "Input", label: "channels.matrixUserId" },
      {
        control: "Input",
        label: "channels.matrixAccessToken",
        password: true,
      },
      { control: "Input", label: "channels.matrixPassword", password: true },
      { control: "Input", label: "channels.matrixDeviceName" },
      { control: "Switch", label: "channels.matrixEncryption" },
      { control: "Input", label: "channels.matrixAutoJoin" },
      { control: "Input", label: "channels.allowFrom" },
    ]);
  });

  it("renders feishu policy rows as Selects, not text inputs", async () => {
    // configs/FeishuConfig.tsx used Select for domain/dmPolicy/groupPolicy/
    // renderMode and a Switch for requireMention.
    const rows = await renderChannel(CHANNEL_TYPE.FEISHU);
    expect(rows.map((r) => r.control)).toEqual([
      "Select",
      "Input",
      "Input",
      "Input",
      "Select",
      "Select",
      "Switch",
      "Select",
      "Input",
    ]);
    expect(rows.filter((r) => r.password).map((r) => r.label)).toEqual([
      "channels.feishuAppSecret",
      "channels.feishuEncryptKey",
    ]);
  });
});
