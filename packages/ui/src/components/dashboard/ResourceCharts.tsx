import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MetricsPeriod } from "@rserve-proxy/shared";

interface ResourceDataPoint {
  cpuPercent: number;
  memoryMB: number;
  memoryLimitMB: number;
  networkRxBytes: number;
  networkTxBytes: number;
  collectedAt: string;
}

interface ResourceChartsProps {
  dataPoints: ResourceDataPoint[];
  period: MetricsPeriod;
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
};

export function ResourceCharts({ dataPoints, period }: ResourceChartsProps) {
  const chartData = useMemo(
    () =>
      dataPoints.map((dp) => ({
        time: formatTime(dp.collectedAt, period),
        cpuPercent: dp.cpuPercent,
        memoryMB: dp.memoryMB,
        memoryLimitMB: dp.memoryLimitMB,
        networkRx: dp.networkRxBytes,
        networkTx: dp.networkTxBytes,
      })),
    [dataPoints, period],
  );

  const maxMemLimit = useMemo(
    () => Math.max(...dataPoints.map((dp) => dp.memoryLimitMB), 1),
    [dataPoints],
  );

  if (dataPoints.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No metrics data yet. Data will appear after the first collection cycle (60s).
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
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
    </div>
  );
}
