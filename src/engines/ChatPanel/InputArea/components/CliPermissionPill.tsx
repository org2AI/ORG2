import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { DropdownItem, DropdownPanel } from "@src/components/Dropdown/exports";
import { DROPDOWN_WIDTHS } from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import SelectorPill from "@src/components/SelectorPill";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { HugeiconsIcon, Shield01Icon } from "@src/icons";
import { sessionByIdAtom } from "@src/store/session";
import { isCliSession } from "@src/util/session/sessionDispatch";

type PermissionMode = "manual" | "auto_edit" | "full_permission";

export default function CliPermissionPill() {
  const { sessionId } = useSessionId();
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const { t } = useTranslation("sessions");
  const [selection, setSelection] = useState<{
    sessionId: string;
    mode: PermissionMode;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const dropdown = useDropdownEngine<HTMLButtonElement>({
    gap: 6,
    align: "left",
    placement: "top",
  });
  const supported =
    !!sessionId &&
    isCliSession(sessionId) &&
    ["codex", "claude_code"].includes(session?.cliAgentType ?? "");
  useEffect(() => {
    let disposed = false;
    generation.current += 1;
    setSaving(false);
    setSelection(null);
    if (supported && sessionId) {
      invoke<PermissionMode>("cli_session_permission", { sessionId })
        .then((mode) => {
          if (!disposed) setSelection({ sessionId, mode });
        })
        .catch((error) => {
          if (!disposed) Message.error(String(error));
        });
    }
    return () => {
      disposed = true;
      generation.current += 1;
    };
  }, [sessionId, supported]);
  if (!supported || !sessionId || selection?.sessionId !== sessionId)
    return null;
  const choices: { mode: PermissionMode; label: string }[] = [
    { mode: "manual", label: t("chat.cliPermissions.ask", "Ask for approval") },
    {
      mode: "auto_edit",
      label:
        session?.cliAgentType === "codex"
          ? t("chat.cliPermissions.workspace", "Workspace access")
          : t("chat.cliPermissions.edit", "Allow edits"),
    },
    {
      mode: "full_permission",
      label: t("chat.cliPermissions.full", "Full access"),
    },
  ];
  const choose = async (mode: PermissionMode) => {
    if (saving) return;
    setSaving(true);
    const requestGeneration = generation.current;
    try {
      await invoke("cli_session_permission", { sessionId, mode });
      if (requestGeneration !== generation.current) return;
      setSelection({ sessionId, mode });
      dropdown.close();
    } catch (error) {
      if (requestGeneration === generation.current)
        Message.error(String(error));
    } finally {
      if (requestGeneration === generation.current) setSaving(false);
    }
  };
  return (
    <>
      <SelectorPill
        icon={<HugeiconsIcon icon={Shield01Icon} size={14} />}
        ref={dropdown.triggerRef}
        label={
          choices.find((c) => c.mode === selection.mode)?.label ??
          choices[0].label
        }
        tooltip={t(
          "chat.cliPermissions.nextTurn",
          "Permissions apply to the next turn"
        )}
        onClick={dropdown.toggle}
        active={dropdown.isOpen}
        dataTestId="cli-permission-pill"
        size="sm"
      />
      {dropdown.isOpen &&
        dropdown.isPositioned &&
        createPortal(
          <DropdownPanel
            ref={dropdown.panelRef}
            className={`fixed ${DROPDOWN_WIDTHS.menuClass}`}
            style={{
              top: dropdown.panelPosition.top,
              bottom: dropdown.panelPosition.bottom,
              left: dropdown.panelPosition.left,
            }}
          >
            {choices.map((choice) => (
              <DropdownItem
                key={choice.mode}
                onClick={() => {
                  choose(choice.mode).catch((error) => {
                    Message.error(String(error));
                  });
                }}
                disabled={saving}
              >
                {choice.label}
              </DropdownItem>
            ))}
          </DropdownPanel>,
          document.body
        )}
    </>
  );
}
