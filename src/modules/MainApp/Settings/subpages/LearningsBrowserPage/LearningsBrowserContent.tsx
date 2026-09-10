import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LearningRecord } from "@src/api/tauri/rpc/schemas/learning";
import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import { useLearningsBrowser } from "@src/hooks/settings";

import { LearningExpandedCard } from "./LearningExpandedCard";
import { LearningsTable, getNextLearningsLimit } from "./LearningsTable";
import { LEARNINGS_PAGE_SIZE, READ_ONLY_LEARNING_STATUSES } from "./constants";
import { useLearningsTableConfig } from "./useLearningsTableConfig";

export interface LearningsBrowserContentProps {
  agentScopes?: string[];
  agentScopeLabels?: Record<string, string>;
}

export const LearningsBrowserContent: React.FC<
  LearningsBrowserContentProps
> = ({ agentScopes, agentScopeLabels }) => {
  const { t } = useTranslation("settings");
  const {
    items,
    loading,
    error,
    filters,
    setFilters,
    refresh,
    setStatus,
    remove,
  } = useLearningsBrowser({ agentScopes });
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(LEARNINGS_PAGE_SIZE);
  const [expandedLearningKeys, setExpandedLearningKeys] = useState<string[]>(
    []
  );

  useEffect(() => {
    setVisibleLimit(LEARNINGS_PAGE_SIZE);
  }, [
    agentScopes,
    filters.search,
    filters.status,
    filters.source,
    filters.category,
    filters.agentScope,
  ]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ ...filters, search: value || undefined });
    },
    [filters, setFilters]
  );

  const runAction = useCallback(
    async (id: string, promise: Promise<void>, successKey: string) => {
      setActioningId(id);
      try {
        await promise;
        Message.success({ content: t(successKey) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Message.error({ content: message });
      } finally {
        setActioningId(null);
      }
    },
    [t]
  );

  const handlePromote = useCallback(
    (row: LearningRecord) => {
      void runAction(
        row.id,
        setStatus(row.id, "active"),
        "learningsBrowser.toast.promoted"
      );
    },
    [runAction, setStatus]
  );

  const handleDeprecate = useCallback(
    (row: LearningRecord) => {
      void runAction(
        row.id,
        setStatus(row.id, "deprecated"),
        "learningsBrowser.toast.deprecated"
      );
    },
    [runAction, setStatus]
  );

  const handleReactivate = useCallback(
    (row: LearningRecord) => {
      void runAction(
        row.id,
        setStatus(row.id, "active"),
        "learningsBrowser.toast.reactivated"
      );
    },
    [runAction, setStatus]
  );

  const handleDelete = useCallback(
    (row: LearningRecord) => {
      void runAction(row.id, remove(row.id), "learningsBrowser.toast.deleted");
    },
    [runAction, remove]
  );

  const getAgentLabel = useCallback(
    (row: LearningRecord) =>
      agentScopeLabels?.[row.agent_scope] ?? row.agent_scope,
    [agentScopeLabels]
  );

  const getCategoryLabel = useCallback(
    (row: LearningRecord) =>
      t(`learningsBrowser.category.${row.category}`, row.category),
    [t]
  );

  const { columns, selectFilters } = useLearningsTableConfig({
    filters,
    setFilters,
    actioningId,
    t,
    getAgentLabel,
    getCategoryLabel,
    handlePromote,
    handleDeprecate,
    handleReactivate,
    handleDelete,
  });

  const filteredItems = useMemo(
    () =>
      items.filter((row) => !READ_ONLY_LEARNING_STATUSES.includes(row.status)),
    [items]
  );

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleLimit),
    [filteredItems, visibleLimit]
  );

  const tableSection = (
    <LearningsTable
      loading={loading}
      filtersSearch={filters.search}
      columns={columns}
      selectFilters={selectFilters}
      visibleItems={visibleItems}
      filteredItemCount={filteredItems.length}
      expandedLearningKeys={expandedLearningKeys}
      t={t}
      onSearchChange={handleSearchChange}
      onExpandedRowsChange={(keys) => setExpandedLearningKeys(keys.slice(-1))}
      onLoadMore={() => setVisibleLimit(getNextLearningsLimit)}
      renderExpandedLearningCard={(row) => (
        <LearningExpandedCard
          row={row}
          t={t}
          getAgentLabel={getAgentLabel}
          getCategoryLabel={getCategoryLabel}
        />
      )}
    />
  );

  if (error) {
    return (
      <Placeholder
        variant="error"
        placement="detail-panel"
        onRetry={() => void refresh()}
      />
    );
  }
  return <>{tableSection}</>;
};
