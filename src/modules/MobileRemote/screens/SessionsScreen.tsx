import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import IconButton from "@src/components/Button";
import Input from "@src/components/Input";
import InlineAlert from "@src/components/PageNotice";
import { Placeholder } from "@src/components/Placeholder";
import { createLogger } from "@src/hooks/logger";
import { Cancel01Icon, HugeiconsIcon, Search01Icon } from "@src/icons";

import { useMobileRemote } from "../app";
import { useMobileVisitedSessions } from "../app/useMobileReadStateSync";
import { useMobileSessionSearch } from "../app/useMobileSessionSearch";
import { MobileConnectionNotice } from "../components/MobileConnectionNotice";
import { MobileTopBar } from "../components/MobileTopBar";
import { SessionDeviceTabs } from "../components/SessionDeviceTabs";
import { SessionListItem } from "../components/SessionListItem";
import { SessionViewMenu } from "../components/SessionViewMenu";
import {
  type SessionGroupBy,
  groupMobileSessions,
} from "../components/sessionGrouping";
import { mobileSessionRowStatus } from "../components/sessionRowPresentation";
import { derivePairedDesktopPresence } from "../connection/mobilePairedDesktopPresence";
import "../mobileDiscovery.scss";
import { useMobileRemotePlatform } from "../platform";

const SEARCH_ACTION_STYLE = {
  minHeight: "var(--mobile-touch-size)",
  fontSize: "var(--mobile-type-control-size)",
};
// Override Button's inline size defaults through its supported style API.
const SEARCH_LAUNCHER_STYLE = {
  height: "var(--mobile-search-height)",
  padding: "0 var(--mobile-search-padding-x)",
  borderRadius: "var(--mobile-search-radius)",
  fontSize: "var(--mobile-search-font-size)",
};

export interface SessionsScreenProps {
  onSelectSession?: (sessionId: string) => void;
  profileAction?: React.ReactNode;
  /** Keep the bounded search state across chat navigation, without hidden UI/work. */
  active?: boolean;
}

/** M-05 Sessions / Online (M-06 offline banner when presence offline). */
export function SessionsScreen({
  onSelectSession,
  profileAction,
  active = true,
}: SessionsScreenProps) {
  const { t } = useTranslation("mobileRemote");
  const { runtime } = useMobileRemotePlatform();
  const {
    connection,
    retryConnection,
    rpc,
    pendingInbox,
    sessions,
    sessionsHasMore,
    rosterPhase,
    refreshSessions,
    loadMoreSessions,
    readStateSync,
    pairedDesktops = [],
    switchPairedDesktop,
  } = useMobileRemote();
  const visitedSessions = useMobileVisitedSessions(readStateSync);
  const [groupBy, setGroupBy] = useState<SessionGroupBy>("none");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);
  const switchingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const desktops = derivePairedDesktopPresence({
    desktops: pairedDesktops,
    activePresence: connection.presence,
  });
  const deviceItems = desktops.length
    ? desktops
    : [
        {
          id: connection.desktopId ?? "current",
          name: connection.desktopName ?? "Desktop",
          presence: connection.presence,
          current: true,
        },
      ];
  const currentDesktopId = deviceItems.find((item) => item.current)?.id ?? null;
  const groups = groupMobileSessions(sessions, groupBy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const offline = connection.presence === "offline";
  const online =
    connection.status === "connected" && connection.presence === "online";
  const [view, setView] = useState<"all" | "search">("all");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [visible, setVisible] = useState(() => !runtime.isHidden());
  useEffect(() => {
    const update = () => setVisible(!runtime.isHidden());
    update();
    return runtime.subscribeVisibility(update);
  }, [runtime]);
  const search = useMobileSessionSearch(rpc, online && active && visible);
  const { search: runSearch, phase: searchPhase } = search;
  useEffect(() => {
    if (
      !active ||
      !visible ||
      !online ||
      composing ||
      view !== "search" ||
      !query.trim() ||
      searchPhase !== "idle" ||
      connection.capabilities?.sessionSearch !== true
    )
      return;
    const timer = runtime.setTimeout(() => void runSearch(query), 200);
    return () => runtime.clearTimeout(timer);
  }, [
    active,
    visible,
    online,
    composing,
    view,
    query,
    searchPhase,
    runSearch,
    runtime,
    connection.capabilities?.sessionSearch,
  ]);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const allList = useRef<HTMLDivElement>(null);
  const searchList = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef({ all: 0, search: 0 });
  const showResults = view === "search" && !!query.trim();
  const showAll = !showResults;
  useEffect(() => {
    readStateSync?.watch(
      active && visible
        ? (showResults ? search.sessions : sessions).map((row) => row.id)
        : []
    );
  }, [
    readStateSync,
    active,
    visible,
    view,
    showResults,
    search.sessions,
    sessions,
  ]);
  useEffect(() => () => readStateSync?.watch([]), [readStateSync]);
  useLayoutEffect(() => {
    if (!active) return;
    if (showAll && allList.current)
      allList.current.scrollTop = scrollPositions.current.all;
    if (showResults && searchList.current)
      searchList.current.scrollTop = scrollPositions.current.search;
  }, [active, showAll, showResults]);
  const pending = new Set(pendingInbox?.items.map((item) => item.sessionId));
  const renderSession = (
    session: (typeof sessions)[number],
    showWorkspace: boolean
  ) => (
    <SessionListItem
      key={session.id}
      sessionId={session.id}
      name={session.name}
      display={session.display}
      visited={visitedSessions?.get(session.id)}
      mergeStatus={session.mergeStatus}
      status={
        !online
          ? "offline"
          : pending.has(session.id)
            ? "awaiting_approval"
            : !session.lifecycleStatus &&
                pendingInbox &&
                pendingInbox.phase !== "unsupported" &&
                (pendingInbox.phase !== "ready" || !pendingInbox.complete)
              ? "unknown"
              : mobileSessionRowStatus(session)
      }
      workspaceName={showWorkspace ? session.repoName : undefined}
      compact={!showWorkspace}
      updatedAtMs={session.updatedAtMs}
      onSelect={() => {
        scrollPositions.current = {
          all:
            showAll && allList.current
              ? allList.current.scrollTop
              : scrollPositions.current.all,
          search:
            searchList.current?.scrollTop ?? scrollPositions.current.search,
        };
        onSelectSession?.(session.id);
      }}
    />
  );
  const closeSecondary = () => {
    flushSync(() => setView("all"));
    search.cancel();
    setQuery("");
    setComposing(false);
    scrollPositions.current.search = 0;
    searchButton.current?.focus();
  };

  // Retain only controller state while in chat; do not render hidden rows.
  if (!active) return null;

  return (
    <section
      className="mobile-discovery"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          view !== "all" &&
          !composing &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          closeSecondary();
        }
      }}
    >
      <MobileTopBar
        title={t("tabs.sessions")}
        leading={profileAction}
        trailing={<SessionViewMenu value={groupBy} onChange={setGroupBy} />}
      />
      <SessionDeviceTabs
        items={deviceItems}
        currentId={currentDesktopId}
        disabled={switching}
        onSelect={(id) => {
          if (
            switchingRef.current ||
            id === currentDesktopId ||
            !switchPairedDesktop
          )
            return;
          switchingRef.current = true;
          setSwitching(true);
          setSwitchError(false);
          closeSecondary();
          void switchPairedDesktop(id)
            .catch(() => {
              if (mounted.current) setSwitchError(true);
            })
            .finally(() => {
              switchingRef.current = false;
              if (mounted.current) setSwitching(false);
            });
        }}
      />
      {switchError ? (
        <p role="alert" className="mobile-discovery-notice">
          {t("devices.switchFailed")}
        </p>
      ) : null}
      <MobileConnectionNotice
        connection={connection}
        onRetry={retryConnection}
        className="mobile-discovery-notice"
      />
      <div
        ref={allList}
        onScroll={(event) => {
          if (showAll)
            scrollPositions.current.all = event.currentTarget.scrollTop;
        }}
        hidden={!showAll}
        className={showAll ? "mobile-discovery-scroll" : "hidden"}
      >
        {online &&
        (rosterPhase === "error" ||
          rosterPhase === "loading" ||
          rosterPhase === "idle" ||
          (rosterPhase === "ready" && sessions.length === 0)) ? (
          <div
            className="mobile-discovery-notice"
            role={rosterPhase === "error" ? "alert" : "status"}
          >
            <p>
              {t(
                rosterPhase === "error"
                  ? sessions.length
                    ? "sessions.refreshFailed"
                    : "sessions.loadFailed"
                  : rosterPhase === "ready"
                    ? "sessions.empty"
                    : sessions.length
                      ? "sessions.refreshing"
                      : "sessions.loading"
              )}
            </p>
            {rosterPhase === "error" ? (
              <Button
                variant="tertiary"
                size="large"
                style={SEARCH_ACTION_STYLE}
                onClick={() => {
                  void refreshSessions().catch(() => undefined);
                }}
              >
                {t("sessions.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {groups.map((group) => (
          <React.Fragment key={group.id}>
            <div className="mobile-discovery-section-label break-words">
              {group.label ??
                t(
                  group.id === "all"
                    ? "sessions.all"
                    : group.id === "today"
                      ? "sessions.groupToday"
                      : group.id === "earlier"
                        ? "sessions.groupEarlier"
                        : group.id === "no_workspace"
                          ? "sessions.groupNoWorkspace"
                          : "sessions.groupUnknown"
                )}
            </div>
            <div className="mobile-session-list">
              {group.sessions.map((session) =>
                renderSession(session, groupBy !== "workspace")
              )}
            </div>
          </React.Fragment>
        ))}
        {sessions.length >= 1000 ? (
          <p className="px-2 text-text-2">{t("sessions.limit")}</p>
        ) : null}
        {sessionsHasMore ? (
          <Button
            className="mobile-discovery-more"
            style={SEARCH_ACTION_STYLE}
            disabled={offline || loading}
            loading={loading}
            onClick={() => {
              if (loading) return;
              setLoading(true);
              setError(false);
              void loadMoreSessions()
                .catch(() => setError(true))
                .finally(() => setLoading(false));
            }}
          >
            {t(error ? "sessions.retry" : "sessions.loadMore")}
          </Button>
        ) : null}
      </div>
      {showResults && connection.capabilities?.sessionSearch === true ? (
        <div
          ref={searchList}
          className="mobile-discovery-scroll"
          onScroll={(event) => {
            scrollPositions.current.search = event.currentTarget.scrollTop;
          }}
        >
          <>
            {online &&
            (search.phase === "loading" || search.phase === "idle") ? (
              <p role="status" className="py-3">
                {t("search.loading")}
              </p>
            ) : null}
            {search.phase === "error" ? (
              <InlineAlert
                type="danger"
                role="alert"
                className="my-3"
                action={
                  <Button
                    style={SEARCH_ACTION_STYLE}
                    disabled={!online}
                    onClick={() => void search.retry()}
                  >
                    {t("search.retry")}
                  </Button>
                }
              >
                <span className="mobile-type-body">{t("search.error")}</span>
              </InlineAlert>
            ) : null}
            {search.phase === "ready" && search.sessions.length === 0 ? (
              <Placeholder
                titleClassName="mobile-type-heading"
                subtitleClassName="mobile-type-secondary"
                variant="empty"
                placement="detail-panel"
                title={t(search.hasMore ? "search.continue" : "search.empty")}
                icon={<HugeiconsIcon icon={Search01Icon} size={24} />}
              />
            ) : null}
            {search.query ? (
              <p className="mobile-type-secondary pt-3 break-words text-text-2">
                {t("search.resultsFor", { query: search.query })}
              </p>
            ) : null}
            <div
              aria-busy={search.phase === "loading"}
              className="mobile-session-list py-3"
            >
              {search.sessions.map((session) => renderSession(session, true))}
            </div>
            {search.hasMore && search.phase !== "error" ? (
              <Button
                style={SEARCH_ACTION_STYLE}
                disabled={!online || search.phase === "loading"}
                onClick={() => void search.loadNext()}
              >
                {t("search.next")}
              </Button>
            ) : null}
          </>
        </div>
      ) : null}
      {view === "all" ? (
        <div className="mobile-discovery-search mobile-discovery-search--launcher">
          <Button
            ref={searchButton}
            variant="tertiary"
            className="mobile-search-launcher"
            style={SEARCH_LAUNCHER_STYLE}
            icon={
              <HugeiconsIcon
                icon={Search01Icon}
                className="mobile-search-icon"
                aria-hidden
              />
            }
            aria-label={t("search.title")}
            onClick={() => {
              flushSync(() => setView("search"));
              searchInput.current?.focus();
            }}
          >
            {t("search.title")}
          </Button>
        </div>
      ) : null}
      {view === "search" ? (
        <div className="mobile-discovery-search">
          {connection.capabilities?.sessionSearch !== true ? (
            <div className="mobile-search-form">
              <p className="min-w-0 flex-1">{t("search.unsupported")}</p>
              <Button
                variant="tertiary"
                className="mobile-discovery-cancel"
                style={SEARCH_ACTION_STYLE}
                onClick={closeSecondary}
              >
                {t("search.cancel")}
              </Button>
            </div>
          ) : (
            <form
              role="search"
              className="mobile-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (composing) return;
                void search
                  .search(query)
                  .catch((error) =>
                    logger.warn("Background operation failed", error)
                  );
                if (online && query.trim()) searchInput.current?.blur();
              }}
            >
              <Input
                ref={searchInput}
                enterKeyHint="search"
                prefix={
                  <HugeiconsIcon
                    icon={Search01Icon}
                    className="mobile-search-icon"
                    aria-hidden
                  />
                }
                type="search"
                aria-label={t("search.placeholder")}
                placeholder={t("search.placeholder")}
                value={query}
                maxLength={200}
                suffix={
                  query ? (
                    <IconButton
                      variant="tertiary"
                      aria-label={t("search.clear")}
                      className="mobile-search-clear"
                      onClick={() => {
                        setQuery("");
                        setComposing(false);
                        search.cancel();
                        scrollPositions.current.search = 0;
                        searchInput.current?.focus();
                      }}
                      iconOnly
                      shape="circle"
                      style={{
                        width: "var(--mobile-touch-size)",
                        height: "var(--mobile-touch-size)",
                        padding: 0,
                      }}
                      icon={
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={18}
                          aria-hidden
                        />
                      }
                    />
                  ) : undefined
                }
                className="mobile-search-input min-w-0 flex-1"
                onCompositionStart={() => {
                  setComposing(true);
                  search.cancel();
                }}
                onCompositionEnd={() => setComposing(false)}
                onChange={(value) => {
                  if (showAll && allList.current)
                    scrollPositions.current.all = allList.current.scrollTop;
                  setQuery(value);
                  search.cancel();
                  scrollPositions.current.search = 0;
                  if (searchList.current) searchList.current.scrollTop = 0;
                }}
                size="large"
              />
              <Button
                variant="tertiary"
                className="mobile-discovery-cancel"
                style={SEARCH_ACTION_STYLE}
                onClick={closeSecondary}
              >
                {t("search.cancel")}
              </Button>
            </form>
          )}
          {!online ? (
            <p className="text-text-2">{t("search.offline")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

SessionsScreen.displayName = "SessionsScreen";

const logger = createLogger("SessionsScreen");
