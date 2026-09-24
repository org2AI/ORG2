import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getAgentOrgHistoryDescriptor,
  getAgentOrgHistoryPage,
} from "@src/api/tauri/agent/orgTasks/history";
import type {
  AgentOrgHistoryDescriptor,
  AgentOrgHistoryPage,
} from "@src/api/tauri/agent/orgTasks/history";
import Button from "@src/components/Button";
import Markdown from "@src/components/MarkDown";
import {
  isCliSession,
  isImportedHistorySession,
} from "@src/util/session/sessionDispatch";

import SessionReadOnlyBar from "./InputArea/components/SessionReadOnlyBar";

interface Props {
  sessionId: string;
  renderTranscript: (
    sessionId: string,
    historyOnly: boolean
  ) => React.ReactNode;
}

/** Resolves identity once per open; history never subscribes to live run polling. */
export default function AgentOrgHistoryBoundary({
  sessionId,
  renderTranscript,
}: Props) {
  const { t } = useTranslation("sessions");
  const [resolved, setResolved] = useState<{
    key: string;
    value: AgentOrgHistoryDescriptor | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([sessionId, attempt]);
  const native =
    !isCliSession(sessionId) && !isImportedHistorySession(sessionId);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void getAgentOrgHistoryDescriptor(sessionId)
      .then((value) => {
        if (!cancelled) setResolved({ key: requestKey, value, error: null });
      })
      .catch((reason) => {
        if (!cancelled)
          setResolved({ key: requestKey, value: null, error: String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, requestKey, native]);
  if (!native) return renderTranscript(sessionId, false);
  const current = resolved?.key === requestKey ? resolved : null;
  if (!current || current.error) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center p-4 text-text-3"
      >
        {current?.error ? (
          <div role="alert">
            {current.error}
            <Button
              variant="tertiary"
              size="small"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("agentOrgHistory.retry")}
            </Button>
          </div>
        ) : (
          t("agentOrgHistory.loading")
        )}
      </div>
    );
  }
  if (current.value?.mode !== "history_only")
    return renderTranscript(sessionId, false);
  return (
    <HistoricalSession
      key={sessionId}
      sessionId={sessionId}
      descriptor={current.value}
      renderTranscript={renderTranscript}
    />
  );
}

function HistoricalSession({
  sessionId,
  descriptor,
  renderTranscript,
}: Props & { descriptor: AgentOrgHistoryDescriptor }) {
  const { t } = useTranslation("sessions");
  const [selected, setSelected] = useState(sessionId);
  const [showSaved, setShowSaved] = useState(false);
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-org-history-only"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-2 p-2">
        {descriptor.members.map((member) => (
          <Button
            key={member.sessionId}
            variant="tertiary"
            size="small"
            aria-pressed={!showSaved && selected === member.sessionId}
            onClick={() => {
              setSelected(member.sessionId);
              setShowSaved(false);
            }}
          >
            {member.name ??
              member.memberId ??
              t("agentOrgHistory.unknownMember")}
          </Button>
        ))}
        <Button
          variant="tertiary"
          size="small"
          aria-pressed={showSaved}
          onClick={() => setShowSaved(true)}
        >
          {t("agentOrgHistory.savedContent")}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {showSaved ? (
          <SavedContent sessionId={sessionId} />
        ) : (
          renderTranscript(selected, true)
        )}
      </div>
      <div className="shrink-0 p-2">
        <SessionReadOnlyBar
          label={t("agentOrgHistory.readOnly")}
          showContextInfo={false}
        />
      </div>
    </div>
  );
}

function SavedContent({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("sessions");
  const [cursor, setCursor] = useState<string | null>(null);
  const [result, setResult] = useState<{
    key: string;
    page: AgentOrgHistoryPage | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([sessionId, cursor, attempt]);
  const current = result?.key === requestKey ? result : null;
  const page = current?.page;
  const error = current?.error;
  const loading = !current;
  useEffect(() => {
    let cancelled = false;
    void getAgentOrgHistoryPage(sessionId, cursor)
      .then((value) => {
        if (!cancelled)
          setResult({ key: requestKey, page: value, error: null });
      })
      .catch((reason) => {
        if (!cancelled)
          setResult({ key: requestKey, page: null, error: String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cursor, requestKey]);
  return (
    <div
      className="h-full overflow-y-auto p-4"
      data-testid="agent-org-history-saved-content"
    >
      {error && (
        <div role="alert">
          {error}
          <Button
            variant="tertiary"
            size="small"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("agentOrgHistory.retry")}
          </Button>
        </div>
      )}
      {!loading && page?.items.length === 0 && (
        <p>{t("agentOrgHistory.empty")}</p>
      )}
      {page?.items.map((item) => (
        <article key={item.id} className="mb-4 border-b border-border-2 pb-4">
          <time className="text-xs text-text-3">{item.createdAt}</time>
          <Markdown textContent={item.content} />
        </article>
      ))}
      {page?.nextCursor && (
        <Button
          variant="secondary"
          size="small"
          loading={loading}
          onClick={() => setCursor(page.nextCursor)}
        >
          {t("agentOrgHistory.nextPage")}
        </Button>
      )}
      {cursor && (
        <Button
          variant="tertiary"
          size="small"
          disabled={loading}
          onClick={() => setCursor(null)}
        >
          {t("agentOrgHistory.firstPage")}
        </Button>
      )}
    </div>
  );
}
