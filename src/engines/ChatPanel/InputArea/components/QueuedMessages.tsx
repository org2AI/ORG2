/**
 * QueuedMessages Component
 *
 * Renders queued messages as a tray tucked behind the top edge of the
 * composer shell: InputArea renders it (via `composerTray`) directly above the
 * shell, and the tray's bottom padding slides under the shell's rounded top.
 * Always visible while messages are queued — rows only: no collapsed pill
 * and no count / clear-all header (each row carries its own actions).
 * Supports drag-and-drop reordering via dnd-kit (vertical sortable list).
 *
 * Edit triggers the main input box via queueEditTargetAtom.
 *
 * Shares `reorderActiveRef` — a module-level flag so the parent file drop zone
 * can check synchronously whether a queue reorder drag is in progress and skip
 * showing the file drop overlay.
 */
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  closestCenter,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useWebViewSensors } from "@src/components/dnd/useWebViewSensors";
import {
  CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS,
  CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS,
  COMPOSER_TRAY_SHELL_CLASSES,
} from "@src/config/composerStackTokens";
import {
  type QueuedMessage,
  messageQueueHandoffIdsAtom,
  queueEditTargetAtom,
} from "@src/store/ui/messageQueueAtom";
import { reorderActiveRef } from "@src/store/ui/queueReorderState";

import QueuedMessageItem from "./QueuedMessageItem";

export interface QueuedMessagesProps {
  messages: QueuedMessage[];
  onCancel: (messageId: string) => void;
  onSendNow: (messageId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const QueuedMessages: React.FC<QueuedMessagesProps> = memo(
  ({ messages, onCancel, onSendNow, onReorder }) => {
    const setEditTarget = useSetAtom(queueEditTargetAtom);
    const editTarget = useAtomValue(queueEditTargetAtom);
    const handoffIds = useAtomValue(messageQueueHandoffIdsAtom);

    // Clear edit target if the message being edited was removed from the queue
    useEffect(() => {
      if (
        editTarget &&
        !messages.some((msg) => msg.id === editTarget.messageId)
      ) {
        setEditTarget(null);
      }
    }, [messages, editTarget, setEditTarget]);

    const [draggingId, setDraggingId] = useState<string | null>(null);

    const sensors = useWebViewSensors({ activationDistance: 5 });
    const sortableIds = useMemo(
      () => messages.map((msg) => msg.id),
      [messages]
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
      reorderActiveRef.current = true;
      setDraggingId(event.active.id as string);
    }, []);

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        reorderActiveRef.current = false;
        setDraggingId(null);
        const { active, over } = event;
        if (over && active.id !== over.id) {
          const oldIndex = messages.findIndex((msg) => msg.id === active.id);
          const newIndex = messages.findIndex((msg) => msg.id === over.id);
          if (oldIndex !== -1 && newIndex !== -1) {
            onReorder(oldIndex, newIndex);
          }
        }
      },
      [messages, onReorder]
    );

    const handleDragCancel = useCallback(() => {
      reorderActiveRef.current = false;
      setDraggingId(null);
    }, []);

    const startEdit = useCallback(
      (msg: QueuedMessage) => {
        // Seed the editor from the DISPLAY copy: `msg.content` is the agent
        // projection (skill tokens expanded, canvas contract) and must never
        // become visible/editable text. `editMessageAtom` re-runs the
        // projection on save, so editing from the display form is lossless.
        setEditTarget({
          messageId: msg.id,
          content: msg.displayContent,
          imageDataUrls: msg.imageDataUrls,
        });
      },
      [setEditTarget]
    );

    if (messages.length === 0) return null;

    const draggable = messages.length > 1;

    return (
      <div
        data-testid="queued-messages-tray"
        className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} ${COMPOSER_TRAY_SHELL_CLASSES}`}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <div
              className={`${CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS} max-h-[192px] overflow-y-auto`}
            >
              {messages.map((msg) => (
                <QueuedMessageItem
                  key={msg.id}
                  msg={msg}
                  draggable={draggable}
                  isDragging={draggingId === msg.id}
                  isEditing={editTarget?.messageId === msg.id}
                  isHandoff={Boolean(handoffIds?.has(msg.id))}
                  onStartEdit={startEdit}
                  onSendNow={onSendNow}
                  onCancel={onCancel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  }
);

QueuedMessages.displayName = "QueuedMessages";

export default QueuedMessages;
