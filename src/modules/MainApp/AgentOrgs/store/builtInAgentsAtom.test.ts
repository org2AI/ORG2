import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type { AgentDefinition } from "../types";
import {
  allAgentDefsAtom,
  builtInAgentsAtom,
  customAgentsAtom,
} from "./builtInAgentsAtom";

const builtin: AgentDefinition = {
  id: "builtin:sde",
  name: "SDE",
  builtIn: true,
};
const internal: AgentDefinition = {
  id: "builtin:base",
  name: "Base",
  builtIn: true,
};
const custom: AgentDefinition = {
  id: "custom:reviewer",
  name: "Reviewer",
  builtIn: false,
};

describe("agent definition projections", () => {
  it("projects canonical loads, replacement and removal without separate writes", () => {
    const store = createStore();
    store.set(allAgentDefsAtom, [internal, builtin, custom]);
    expect(store.get(builtInAgentsAtom)).toEqual([builtin]);
    expect(store.get(customAgentsAtom)).toEqual([custom]);
    expect(store.get(allAgentDefsAtom)).toContain(internal);

    const renamed = { ...custom, name: "Updated reviewer" };
    store.set(allAgentDefsAtom, [internal, builtin, renamed]);
    expect(store.get(customAgentsAtom)).toEqual([renamed]);
    store.set(allAgentDefsAtom, [internal, builtin]);
    expect(store.get(customAgentsAtom)).toEqual([]);
    expect(store.get(builtInAgentsAtom)).toEqual([builtin]);
  });

  it("keeps separately mounted stores isolated", () => {
    const first = createStore();
    const second = createStore();
    first.set(allAgentDefsAtom, [builtin]);
    second.set(allAgentDefsAtom, [custom]);
    expect(first.get(customAgentsAtom)).toEqual([]);
    expect(second.get(builtInAgentsAtom)).toEqual([]);
    expect(second.get(customAgentsAtom)).toEqual([custom]);
  });
});
