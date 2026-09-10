import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import Button from "@src/components/Button";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_MARGIN,
  CHART_TOOLTIP,
} from "@src/components/Chart";
import PageNotice from "@src/components/PageNotice";
import { getQuotaTextColorClass } from "@src/components/QuotaBar";
import Select from "@src/components/Select";
import { useWeeklyQuotaHistory } from "@src/hooks/keyVault/useWeeklyQuotaHistory";
import { ArrowLeft01Icon, ArrowRight01Icon, HugeiconsIcon } from "@src/icons";

import {
  RuntimeRefreshButton,
  RuntimeSectionHeader,
} from "./RuntimeSectionHeader";
import { weeklyQuotaRange } from "./weeklyQuotaRange";

export default function WeeklyQuotaHistoryPanel() {
  const { t } = useTranslation("sessions");
  const {
    accounts,
    loading,
    error,
    refresh,
    observedAt: now,
  } = useWeeklyQuotaHistory();
  const [selectedId, setSelectedId] = useState<string>();
  const [week, setWeek] = useState({ keyId: "", offset: 0 });
  const selected =
    accounts.find((account) => account.keyId === selectedId) ?? accounts[0];
  const text = (key: string, fallback: string) =>
    t(`weeklyQuotaHistory.${key}`, { defaultValue: fallback });
  return (
    <section className="space-y-3" data-testid="weekly-quota-history">
      <RuntimeSectionHeader title={text("title", "Weekly quota history")}>
        <RuntimeRefreshButton
          label={text("refresh", "Refresh")}
          onRefresh={refresh}
          refreshing={loading}
        />
      </RuntimeSectionHeader>
      {error ? (
        <PageNotice compact type="warning" role="status">
          {text(
            "error",
            "Quota history is unavailable. It will retry when you return to this window"
          )}
        </PageNotice>
      ) : null}
      {!accounts.length && !error ? (
        <PageNotice compact role="status">
          {loading
            ? text("loading", "Loading quota history…")
            : text(
                "empty",
                "Connect a Claude Code, Codex, or OpenCode Go account in Key Vault to start tracking"
              )}
        </PageNotice>
      ) : null}
      {accounts.length > 1 ? (
        <Select
          value={selected?.keyId}
          ariaLabel={text("account", "Account")}
          options={accounts.map((account) => ({
            value: account.keyId,
            label:
              account.provider === "codex"
                ? account.name
                : `${account.name} · ${account.provider}`,
          }))}
          onChange={(value) => {
            setSelectedId(String(value));
            setWeek({ keyId: String(value), offset: 0 });
          }}
          showSearch
        />
      ) : null}
      {accounts.length === 128 ? (
        <PageNotice compact role="status">
          {text("limit", "Showing up to 128 accounts")}
        </PageNotice>
      ) : null}
      <div className="grid grid-cols-1 gap-3">
        {(selected ? [selected] : []).map((account) => {
          const latest = account.points.at(-1);
          const range = weeklyQuotaRange(
            account.points,
            now,
            week.keyId === account.keyId ? week.offset : 0
          );
          const chartPoints = range.points;
          const visibleLatest = chartPoints.at(-1);
          const accountStatus =
            account.samplingEnabled === false
              ? text("disabled", "Sampling paused for this disabled account")
              : account.status === "unsupported"
                ? text(
                    "unsupported",
                    "This account does not report a weekly quota"
                  )
                : account.status === "unavailable"
                  ? text(
                      "unavailable",
                      "Latest reading unavailable; check the account connection in Key Vault"
                    )
                  : account.status !== "ok" || !latest
                    ? text("pending", "Waiting for the next hourly sample")
                    : now - latest.capturedAt > 2 * 3600
                      ? text("stale", "Last observation is over two hours old")
                      : null;
          const formatDay = (value: number) =>
            new Date(value * 1000).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          const formatDate = (value: number) =>
            new Date(value * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hourCycle: "h23",
            });
          return (
            <div
              key={account.keyId}
              className="min-w-0 space-y-2 rounded-lg border border-border-1 bg-primary-container p-3"
            >
              <div className="flex flex-wrap justify-between gap-2 text-xs text-text-1">
                <span className="font-semibold">
                  {account.name}
                  {account.provider !== "codex"
                    ? ` · ${account.provider}`
                    : null}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  {accountStatus ? (
                    <span
                      role="status"
                      className={
                        account.samplingEnabled === false
                          ? "min-w-0 text-danger-6"
                          : account.status === "ok" &&
                              latest &&
                              now - latest.capturedAt > 2 * 3600
                            ? "min-w-0 text-warning-6"
                            : "min-w-0 text-text-3"
                      }
                    >
                      {accountStatus}
                    </span>
                  ) : null}
                  {accountStatus && visibleLatest ? (
                    <span
                      aria-hidden="true"
                      className="h-4 shrink-0 border-l border-fill-3"
                    />
                  ) : null}
                  {visibleLatest ? (
                    <span className="shrink-0">
                      {visibleLatest.remainingPercent.toFixed(0)}% ·{" "}
                      {formatDate(visibleLatest.capturedAt)}
                    </span>
                  ) : null}
                </div>
              </div>
              {latest && !chartPoints.length ? (
                <PageNotice compact role="status">
                  {text("emptyWeek", "No readings for this week")}
                </PageNotice>
              ) : null}
              {latest ? (
                <div
                  className="h-40 w-full"
                  role="group"
                  aria-label={`${account.name}: ${formatDay(range.start)} – ${formatDay(range.end)}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartPoints}
                      margin={CHART_MARGIN}
                      accessibilityLayer
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={CHART_GRID_STROKE}
                      />
                      <XAxis
                        dataKey="capturedAt"
                        type="number"
                        domain={[range.start, range.end]}
                        allowDataOverflow
                        tickFormatter={formatDate}
                        tick={CHART_AXIS_TICK}
                        minTickGap={50}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 50, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={CHART_AXIS_TICK}
                        width={40}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP.content}
                        labelStyle={CHART_TOOLTIP.label}
                        itemStyle={CHART_TOOLTIP.item}
                        labelFormatter={(value) => formatDate(Number(value))}
                        formatter={(value) => `${Number(value).toFixed(0)}%`}
                      />
                      <Bar
                        name={text("remaining", "Remaining %")}
                        dataKey="remainingPercent"
                        barSize={3}
                        minPointSize={(value) => (value === 0 ? 2 : 0)}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      >
                        {chartPoints.map((point) => (
                          <Cell
                            key={point.capturedAt}
                            fill="currentColor"
                            className={getQuotaTextColorClass(
                              point.remainingPercent ?? 0,
                              50
                            )}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
              {latest ? (
                <div className="flex items-center justify-center gap-2 text-xs text-text-2">
                  <Button
                    htmlType="button"
                    variant="tertiary"
                    size="small"
                    iconOnly
                    aria-label={text("previousWeek", "Previous week")}
                    disabled={range.offset >= range.maxOffset}
                    onClick={() =>
                      setWeek({
                        keyId: account.keyId,
                        offset: range.offset + 1,
                      })
                    }
                    icon={<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />}
                  />
                  <span aria-live="polite">
                    {formatDay(range.start)} – {formatDay(range.end)}
                  </span>
                  <Button
                    htmlType="button"
                    variant="tertiary"
                    size="small"
                    iconOnly
                    aria-label={text("nextWeek", "Next week")}
                    disabled={range.offset === 0}
                    onClick={() =>
                      setWeek({
                        keyId: account.keyId,
                        offset: range.offset - 1,
                      })
                    }
                    icon={<HugeiconsIcon icon={ArrowRight01Icon} size={16} />}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
