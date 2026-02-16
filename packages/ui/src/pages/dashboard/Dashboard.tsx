import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  MetricsPeriod,
  SystemMetricsSnapshot,
  AppStatusHistory,
  AppWithStatus,
} from "@rserve-proxy/shared";
import { api } from "../../lib/api.js";
import { METRICS_POLL_MS, STATUS_POLL_MS } from "../../lib/constants.js";
import { PeriodSelector } from "../../components/dashboard/PeriodSelector.js";
import { ResourceCards } from "../../components/dashboard/ResourceCards.js";
import { UptimeGrid } from "../../components/dashboard/UptimeGrid.js";
import { ResourceCharts } from "../../components/dashboard/ResourceCharts.js";
import { Spinner } from "../../components/ui/Spinner.js";

export function Dashboard() {
  const [period, setPeriod] = useState<MetricsPeriod>("1h");
  const [systemMetrics, setSystemMetrics] = useState<SystemMetricsSnapshot[]>(
    [],
  );
  const [statusApps, setStatusApps] = useState<AppStatusHistory[]>([]);
  const [allApps, setAllApps] = useState<AppWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await api.metrics.system(period);
      setSystemMetrics(res.dataPoints);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    }
  }, [period]);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, appsRes] = await Promise.all([
        api.metrics.statusHistory(period),
        api.apps.list(),
      ]);
      setStatusApps(statusRes.apps);
      setAllApps(appsRes.apps);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load status history",
      );
    }
  }, [period]);

  // Merge: ensure all apps appear in the grid, even without history
  const mergedApps = useMemo(() => {
    const seen = new Set(statusApps.map((a) => a.appId));
    const extras: AppStatusHistory[] = allApps
      .filter((a) => !seen.has(a.id))
      .map((a) => ({
        appId: a.id,
        appName: a.name,
        entries: [{ status: a.status, timestamp: new Date().toISOString() }],
      }));
    return [...statusApps, ...extras];
  }, [statusApps, allApps]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMetrics(), fetchStatus()]).finally(() =>
      setLoading(false),
    );
  }, [fetchMetrics, fetchStatus]);

  // Poll metrics every 60s
  useEffect(() => {
    const id = setInterval(fetchMetrics, METRICS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  // Poll status every 15s
  useEffect(() => {
    const id = setInterval(fetchStatus, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const latest =
    systemMetrics.length > 0
      ? systemMetrics[systemMetrics.length - 1]
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Resource summary cards */}
          <ResourceCards latest={latest} />

          {/* Uptime grid */}
          <UptimeGrid apps={mergedApps} period={period} />

          {/* Resource charts */}
          <ResourceCharts dataPoints={systemMetrics} period={period} />
        </>
      )}
    </div>
  );
}
