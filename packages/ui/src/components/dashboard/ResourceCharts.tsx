import { useMemo } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MetricsPeriod, AggregatedSnapshot } from "@rserve-proxy/shared";

interface ResourceDataPoint {
  cpuPercent: number;
  memoryMB: number;
  memoryLimitMB: number;
  networkRxBytes: number;
  networkTxBytes: number;
  requestsPerMin?: number | null;
  collectedAt: string;
}

interface ResourceChartsProps {
  dataPoints: ResourceDataPoint[];
  period: MetricsPeriod;
  aggregated?: AggregatedSnapshot[];
}

function formatTime(iso: string, period: MetricsPeriod): string {
  const d = new Date(iso);
  if (period === "7d") {
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CHART_COLORS = {
  cpu: "#6366f1",       // indigo-500
  memory: "#8b5cf6",    // violet-500
  memLimit: "#d1d5db",  // gray-300
  networkRx: "#3b82f6", // blue-500
  networkTx: "#22c55e", // green-500
  requests: "#f59e0b",  // amber-500
};

export function ResourceCharts({ dataPoints, period, aggregated }: ResourceChartsProps) {
  const isAggregated = aggregated != null && aggregated.length > 0;

  const chartData = useMemo(
    () =>
      dataPoints.map((dp) => ({
        time: formatTime(dp.collectedAt, period),
        cpuPercent: dp.cpuPercent,
        memoryMB: dp.memoryMB,
        memoryLimitMB: dp.memoryLimitMB,
        networkRx: dp.networkRxBytes,
        networkTx: dp.networkTxBytes,
        requestsPerMin: dp.requestsPerMin ?? 0,
      })),
    [dataPoints, period],
  );

  const aggChartData = useMemo(
    () =>
      aggregated?.map((dp) => ({
        time: formatTime(dp.collectedAt, period),
        cpuAvg: dp.cpuPercent.avg,
        cpuMin: dp.cpuPercent.min,
        cpuMax: dp.cpuPercent.max,
        memAvg: dp.memoryMB.avg,
        memMin: dp.memoryMB.min,
        memMax: dp.memoryMB.max,
        rxAvg: dp.networkRxBytes.avg,
        rxMin: dp.networkRxBytes.min,
        rxMax: dp.networkRxBytes.max,
        txAvg: dp.networkTxBytes.avg,
        txMin: dp.networkTxBytes.min,
        txMax: dp.networkTxBytes.max,
        reqAvg: dp.requestsPerMin?.avg ?? 0,
        reqMin: dp.requestsPerMin?.min ?? 0,
        reqMax: dp.requestsPerMin?.max ?? 0,
        hasRequests: dp.requestsPerMin != null,
      })) ?? [],
    [aggregated, period],
  );

  const maxMemLimit = useMemo(
    () => {
      if (isAggregated) {
        return Math.max(...aggChartData.map((d) => d.memMax), 1);
      }
      return Math.max(...dataPoints.map((dp) => dp.memoryLimitMB), 1);
    },
    [isAggregated, aggChartData, dataPoints],
  );

  const hasRequestData = useMemo(
    () => {
      if (isAggregated) return aggChartData.some((d) => d.hasRequests);
      return dataPoints.some((dp) => dp.requestsPerMin != null);
    },
    [isAggregated, aggChartData, dataPoints],
  );

  const noData = isAggregated ? aggChartData.length === 0 : dataPoints.length === 0;

  if (noData) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No metrics data yet. Data will appear after the first collection cycle.
      </div>
    );
  }

  // Aggregated view — min/max/avg lines for 6h, 24h, 7d
  if (isAggregated) {
    const aggLabel = (name?: string) =>
      name?.includes("Max") ? "Max" : name?.includes("Min") ? "Min" : "Avg";
    const pctFmt = (value: unknown, name?: string) =>
      [`${Number(value).toFixed(1)}%`, aggLabel(name)];
    const mbFmt = (value: unknown, name?: string) =>
      [`${Number(value).toFixed(0)} MB`, aggLabel(name)];
    const netFmt = (value: unknown, name?: string) => {
      const LABELS: Record<string, string> = {
        rxAvg: "Rx Avg", rxMin: "Rx Min", rxMax: "Rx Max",
        txAvg: "Tx Avg", txMin: "Tx Min", txMax: "Tx Max",
      };
      return [formatBytes(Number(value)), LABELS[name ?? ""] ?? name ?? ""];
    };
    const reqFmt = (value: unknown, name?: string) =>
      [`${Number(value).toFixed(1)}/min`, aggLabel(name)];

    return (
      <div className={`grid gap-4 ${hasRequestData ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        {/* CPU Chart — aggregated */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-700">CPU Usage</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={aggChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={40} />
              <Tooltip formatter={pctFmt} />
              <Area type="monotone" dataKey="cpuMax" stroke="none" fill={CHART_COLORS.cpu} fillOpacity={0.08} />
              <Area type="monotone" dataKey="cpuMin" stroke="none" fill="#ffffff" fillOpacity={1} />
              <Line type="monotone" dataKey="cpuMax" name="cpuMax" stroke={CHART_COLORS.cpu} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
              <Line type="monotone" dataKey="cpuMin" name="cpuMin" stroke={CHART_COLORS.cpu} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
              <Line type="monotone" dataKey="cpuAvg" name="cpuAvg" stroke={CHART_COLORS.cpu} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Memory Chart — aggregated */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-700">Memory Usage</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={aggChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, Math.ceil(maxMemLimit * 1.1)]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v} MB`} width={55} />
              <Tooltip formatter={mbFmt} />
              <Area type="monotone" dataKey="memMax" stroke="none" fill={CHART_COLORS.memory} fillOpacity={0.08} />
              <Area type="monotone" dataKey="memMin" stroke="none" fill="#ffffff" fillOpacity={1} />
              <Line type="monotone" dataKey="memMax" name="memMax" stroke={CHART_COLORS.memory} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
              <Line type="monotone" dataKey="memMin" name="memMin" stroke={CHART_COLORS.memory} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
              <Line type="monotone" dataKey="memAvg" name="memAvg" stroke={CHART_COLORS.memory} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Network Chart — aggregated */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-700">Network I/O</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={aggChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={formatBytes} width={55} />
              <Tooltip formatter={netFmt} />
              <Line type="monotone" dataKey="rxMax" stroke={CHART_COLORS.networkRx} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.3} />
              <Line type="monotone" dataKey="rxMin" stroke={CHART_COLORS.networkRx} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.3} />
              <Line type="monotone" dataKey="rxAvg" stroke={CHART_COLORS.networkRx} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="txMax" stroke={CHART_COLORS.networkTx} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.3} />
              <Line type="monotone" dataKey="txMin" stroke={CHART_COLORS.networkTx} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.3} />
              <Line type="monotone" dataKey="txAvg" stroke={CHART_COLORS.networkTx} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Requests Chart — aggregated */}
        {hasRequestData && (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h4 className="mb-3 text-sm font-medium text-gray-700">Requests/min</h4>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={aggChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip formatter={reqFmt} />
                <Area type="monotone" dataKey="reqMax" stroke="none" fill={CHART_COLORS.requests} fillOpacity={0.08} />
                <Area type="monotone" dataKey="reqMin" stroke="none" fill="#ffffff" fillOpacity={1} />
                <Line type="monotone" dataKey="reqMax" name="reqMax" stroke={CHART_COLORS.requests} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
                <Line type="monotone" dataKey="reqMin" name="reqMin" stroke={CHART_COLORS.requests} strokeWidth={1} strokeDasharray="4 2" dot={false} strokeOpacity={0.4} />
                <Line type="monotone" dataKey="reqAvg" name="reqAvg" stroke={CHART_COLORS.requests} strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // Raw data points view (1h, 6h, 24h)
  return (
    <div className={`grid gap-4 ${hasRequestData ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      {/* CPU Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">CPU Usage</h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              width={40}
            />
            <Tooltip
              formatter={(value) => [`${Number(value).toFixed(1)}%`, "CPU"]}
            />
            <Area
              type="monotone"
              dataKey="cpuPercent"
              stroke={CHART_COLORS.cpu}
              fill={CHART_COLORS.cpu}
              fillOpacity={0.15}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Memory Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Memory Usage</h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, Math.ceil(maxMemLimit * 1.1)]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v} MB`}
              width={55}
            />
            <Tooltip
              formatter={(value, name) => [
                `${Number(value).toFixed(0)} MB`,
                name === "memoryMB" ? "Used" : "Limit",
              ]}
            />
            <ReferenceLine
              y={maxMemLimit}
              stroke={CHART_COLORS.memLimit}
              strokeDasharray="4 4"
              label={{ value: "Limit", position: "right", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="memoryMB"
              stroke={CHART_COLORS.memory}
              fill={CHART_COLORS.memory}
              fillOpacity={0.15}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Network Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Network I/O</h4>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={formatBytes}
              width={55}
            />
            <Tooltip
              formatter={(value, name) => [
                formatBytes(Number(value)),
                name === "networkRx" ? "Received" : "Sent",
              ]}
            />
            <Area
              type="monotone"
              dataKey="networkRx"
              stroke={CHART_COLORS.networkRx}
              fill={CHART_COLORS.networkRx}
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="networkTx"
              stroke={CHART_COLORS.networkTx}
              fill={CHART_COLORS.networkTx}
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Requests Chart */}
      {hasRequestData && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-700">
            Requests/min
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}`}
                width={40}
              />
              <Tooltip
                formatter={(value) => [
                  `${Number(value).toFixed(1)}/min`,
                  "Requests",
                ]}
              />
              <Area
                type="monotone"
                dataKey="requestsPerMin"
                stroke={CHART_COLORS.requests}
                fill={CHART_COLORS.requests}
                fillOpacity={0.15}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
