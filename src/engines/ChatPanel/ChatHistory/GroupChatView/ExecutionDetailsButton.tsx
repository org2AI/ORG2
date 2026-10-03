import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  AgentOrgGroupConversationItem,
  AgentOrgRunMemberView,
} from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { loadTurnIndex } from "@src/engines/SessionCore/storage/sqliteCache";
import { loadSessionTurnBodyIntoStore } from "@src/engines/SessionCore/turns";

import { agentOrgExecutionNavigationAtom } from "../agentOrgExecutionNavigation";

export function ExecutionDetailsButton({
  item,
  members,
  onMemberSelect,
  onExitGroup,
}: {
  item: AgentOrgGroupConversationItem;
  members: AgentOrgRunMemberView[];
  onMemberSelect: (member: AgentOrgRunMemberView) => void;
  onExitGroup: () => void;
}) {
  const { t } = useTranslation("sessions");
  const navigate = useSetAtom(agentOrgExecutionNavigationAtom);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const member = members.find(
    (candidate) =>
      candidate.memberId === (item.responderMemberId ?? item.targetMemberId)
  );
  const sessionId = member?.sessionRuntime?.sessionId;
  async function open() {
    if (!sessionId || !member || loading) return;
    setLoading(true);
    try {
      const turnId = `agent-org-execution-${item.turnIntentId}`;
      const [summary] = await loadTurnIndex(sessionId, [turnId]);
      if (summary?.execution?.turnIntentId !== item.turnIntentId) {
        if (mounted.current) setUnavailable(true);
        return;
      }
      await loadSessionTurnBodyIntoStore({ sessionId, turnId });
      if (!mounted.current) return;
      navigate({ sessionId, turnIntentId: item.turnIntentId });
      onExitGroup();
      onMemberSelect(member);
    } catch {
      if (mounted.current) setUnavailable(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  return (
    <Button
      variant="ghost"
      size="inline"
      loading={loading}
      disabled={!sessionId || !item.turnIntentId}
      onClick={() => void open()}
      data-testid="agent-org-execution-details"
      aria-label={t("agentOrgExecution.viewDetails")}
    >
      {t(
        unavailable || !sessionId
          ? "agentOrgExecution.unavailable"
          : "agentOrgExecution.viewDetails"
      )}
    </Button>
  );
}
