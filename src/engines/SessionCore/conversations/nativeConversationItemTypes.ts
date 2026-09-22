/**
 * Provider-native conversation item contract and materialization receipts.
 * Items preserve roles and tool pairing; they never render history into a
 * prompt.
 */

export type NativeConversationItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
      images: string[];
      createdAt: string;
      /** Stable ORG2 turn identity; provider transports may ignore it. */
      turnId?: string;
    }
  | {
      kind: "tool_call";
      id: string;
      callId: string;
      name: string;
      arguments: string;
      createdAt: string;
    }
  | {
      kind: "tool_result";
      id: string;
      callId: string;
      name: string;
      output: string;
      isError: boolean;
      interrupted: boolean;
      createdAt: string;
    }
  | {
      kind: "context_summary";
      id: string;
      summary: string;
      createdAt: string;
    };

export interface NativeMaterializationWireReceipt {
  nativeSessionId: string;
  itemCount: number;
}

export type NativeConversationFidelity =
  | { level: "exact"; omitted: [] }
  | { level: "lossy"; omitted: ["participant_authorship"] };

export interface NativeMaterializationReceipt extends NativeMaterializationWireReceipt {
  /** Content is native; unsupported structured metadata is reported, never injected. */
  fidelity: NativeConversationFidelity;
}

export const MAX_NATIVE_CONVERSATION_ITEMS = 100_000;
export const MAX_NATIVE_CONVERSATION_SERIALIZED_BYTES = 64 * 1024 * 1024;
