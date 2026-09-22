/**
 * Provider-neutral semantic comparison of native conversation items: exact
 * equality/prefix checks, provider-portable prefix checks that normalize
 * tool-call ids by first use, and mismatch diagnostics.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { NativeConversationItem } from "./nativeConversationItemTypes";
import { projectNativeConversationItems } from "./nativeConversationProjection";

export function semanticItem(item: NativeConversationItem): unknown {
  switch (item.kind) {
    case "message":
      return [item.kind, item.role, item.text, item.images];
    case "tool_call":
      return [
        item.kind,
        item.callId,
        item.name,
        canonicalJson(JSON.parse(item.arguments) as unknown),
      ];
    case "tool_result":
      return [
        item.kind,
        item.callId,
        item.name,
        item.output,
        item.isError,
        item.interrupted,
      ];
    case "context_summary":
      return [item.kind, item.summary];
  }
}

/**
 * Provider-neutral semantic identity for one canonical event. Unlike event
 * ids, this survives a native provider parser that exposes only positional
 * ids after materialization. Callers must still match occurrences one-to-one:
 * repeated equal messages in different turns are valid conversation events.
 */
export function nativeConversationEventSemanticKey(
  event: SessionEvent
): string | null {
  const items = projectNativeConversationItems([event]);
  return items.length > 0
    ? JSON.stringify(items.map((item) => semanticItem(item)))
    : null;
}

function nativeItemShape(item: NativeConversationItem | undefined): string {
  if (!item) return "missing";
  switch (item.kind) {
    case "message":
      return `message:${item.role}:text=${item.text.length}:images=${item.images.length}`;
    case "tool_call":
      return `tool_call:${item.name}:call=${item.callId}:arguments=${item.arguments.length}`;
    case "tool_result":
      return `tool_result:${item.name}:call=${item.callId}:output=${item.output.length}`;
    case "context_summary":
      return `context_summary:text=${item.summary.length}`;
  }
}

export function nativeConversationMismatch(
  expected: readonly NativeConversationItem[],
  actual: readonly NativeConversationItem[]
): string {
  const sharedLength = Math.min(expected.length, actual.length);
  let firstMismatch = sharedLength;
  for (let index = 0; index < sharedLength; index += 1) {
    if (
      JSON.stringify(semanticItem(expected[index])) !==
      JSON.stringify(semanticItem(actual[index]))
    ) {
      firstMismatch = index;
      break;
    }
  }
  return [
    `expected=${expected.length}`,
    `actual=${actual.length}`,
    `firstMismatch=${firstMismatch}`,
    `expectedShape=${nativeItemShape(expected[firstMismatch])}`,
    `actualShape=${nativeItemShape(actual[firstMismatch])}`,
  ].join(" ");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)])
    );
  }
  return value;
}

export function nativeConversationItemsEqual(
  left: readonly NativeConversationItem[],
  right: readonly NativeConversationItem[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        JSON.stringify(semanticItem(item)) ===
        JSON.stringify(semanticItem(right[index]))
    )
  );
}

export function nativeConversationItemsArePrefix(
  prefix: readonly NativeConversationItem[],
  complete: readonly NativeConversationItem[]
): boolean {
  return (
    prefix.length <= complete.length &&
    prefix.every(
      (item, index) =>
        JSON.stringify(semanticItem(item)) ===
        JSON.stringify(semanticItem(complete[index]))
    )
  );
}

function providerPortableSemanticItems(
  items: readonly NativeConversationItem[]
): unknown[] | null {
  const calls = new Map<
    string,
    { alias: number; name: string; hasResult: boolean }
  >();
  const semantic: unknown[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "tool_call": {
        if (calls.has(item.callId)) return null;
        const call = {
          alias: calls.size,
          name: item.name,
          hasResult: false,
        };
        calls.set(item.callId, call);
        let args: unknown;
        try {
          args = ["json", canonicalJson(JSON.parse(item.arguments) as unknown)];
        } catch {
          // Invalid provider rows compare only by their exact raw payload;
          // two unrelated parse failures must never collapse to one value.
          args = ["raw", item.arguments];
        }
        semantic.push([item.kind, call.alias, item.name, args]);
        break;
      }
      case "tool_result": {
        const call = calls.get(item.callId);
        if (!call || call.hasResult || call.name !== item.name) return null;
        call.hasResult = true;
        // `interrupted` is ORG2-only refinement. Provider transcripts retain
        // the portable error bit and output but cannot round-trip that flag.
        semantic.push([
          item.kind,
          call.alias,
          item.name,
          item.output,
          item.isError,
        ]);
        break;
      }
      default:
        semantic.push(semanticItem(item));
    }
  }
  return semantic;
}

/**
 * Prefix identity across two provider-native transcripts. Provider call ids
 * are local pairing keys and can be rewritten when Codex history is rebuilt
 * for Claude (or vice versa). Normalize each transcript's ids by first-use
 * order so the call/result topology remains strict while equivalent provider
 * ids do not make an otherwise exact materialized child look divergent.
 */
export function nativeConversationItemsAreProviderPortablePrefix(
  prefix: readonly NativeConversationItem[],
  complete: readonly NativeConversationItem[]
): boolean {
  if (prefix.length > complete.length) return false;
  const prefixSemantic = providerPortableSemanticItems(prefix);
  const completeSemantic = providerPortableSemanticItems(complete);
  if (!prefixSemantic || !completeSemantic) return false;
  return prefixSemantic.every(
    (item, index) =>
      JSON.stringify(item) === JSON.stringify(completeSemantic[index])
  );
}

export function nativeConversationItemsAreProviderPortableEqual(
  left: readonly NativeConversationItem[],
  right: readonly NativeConversationItem[]
): boolean {
  return (
    left.length === right.length &&
    nativeConversationItemsAreProviderPortablePrefix(left, right)
  );
}
