import type { AppStatus, MetricsPeriod, StatusHistoryEntry } from "@rserve-proxy/shared";

/** Number of columns (time buckets) to show per period */
export const BUCKET_COUNTS: Record<MetricsPeriod, number> = {
  "1h": 60,
  "6h": 60,
  "24h": 60,
  "7d": 84, // 2h buckets
};

/** Bucket duration in ms per period */
export const BUCKET_MS: Record<MetricsPeriod, number> = {
  "1h": 60_000,           // 1 min
  "6h": 6 * 60_000,       // 6 min
  "24h": 24 * 60_000,     // 24 min
  "7d": 2 * 60 * 60_000,  // 2 hours
};

export interface BucketInfo {
  /** Percentage of samples with "running" status (0–100), null = no data */
  uptimePercent: number | null;
  /** Most frequent status in this bucket (for tooltip context) */
  dominantStatus: AppStatus | null;
  /** Number of data points in this bucket */
  totalSamples: number;
  startTime: Date;
  endTime: Date;
}

export function bucketize(
  entries: StatusHistoryEntry[],
  period: MetricsPeriod,
): BucketInfo[] {
  const count = BUCKET_COUNTS[period];
  const bucketMs = BUCKET_MS[period];
  const now = Date.now();
  const periodMs = count * bucketMs;
  const startMs = now - periodMs;

  const buckets: BucketInfo[] = [];
  for (let i = 0; i < count; i++) {
    const bucketStart = startMs + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;

    // Collect all entries in this bucket
    let runningCount = 0;
    let totalCount = 0;
    const statusCounts = new Map<AppStatus, number>();

    for (const entry of entries) {
      const t = new Date(entry.timestamp).getTime();
      if (t >= bucketStart && t < bucketEnd) {
        totalCount++;
        if (entry.status === "running") runningCount++;
        statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1);
      }
    }

    let uptimePercent: number | null = null;
    let dominantStatus: AppStatus | null = null;

    if (totalCount > 0) {
      uptimePercent = (runningCount / totalCount) * 100;
      // Find the most frequent status
      let maxCount = 0;
      for (const [status, cnt] of statusCounts) {
        if (cnt > maxCount) {
          maxCount = cnt;
          dominantStatus = status;
        }
      }
    } else if (i > 0) {
      // No data in this bucket — carry forward from previous bucket
      uptimePercent = buckets[i - 1].uptimePercent;
      dominantStatus = buckets[i - 1].dominantStatus;
    }

    buckets.push({
      uptimePercent,
      dominantStatus,
      totalSamples: totalCount,
      startTime: new Date(bucketStart),
      endTime: new Date(bucketEnd),
    });
  }

  return buckets;
}

/** Get Tailwind color class based on uptime percentage */
export function uptimeColor(percent: number | null): string {
  if (percent === null) return "bg-gray-100";
  if (percent === 100) return "bg-green-500";
  if (percent >= 90) return "bg-green-400";
  if (percent >= 50) return "bg-amber-400";
  if (percent > 0) return "bg-red-400";
  return "bg-red-500";
}

export function formatBucketTime(date: Date, period: MetricsPeriod): string {
  if (period === "7d") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatUptimeTooltip(bucket: BucketInfo): string {
  if (bucket.uptimePercent === null) return "no data";
  const pct = bucket.uptimePercent % 1 === 0
    ? bucket.uptimePercent.toFixed(0)
    : bucket.uptimePercent.toFixed(1);
  if (bucket.totalSamples === 0) return `${pct}% uptime (carried)`;
  return `${pct}% uptime (${bucket.totalSamples} samples)`;
}
