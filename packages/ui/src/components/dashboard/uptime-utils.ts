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
  status: AppStatus | null;
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

    // Find entries that fall within this bucket; take the last one
    let status: AppStatus | null = null;
    for (const entry of entries) {
      const t = new Date(entry.timestamp).getTime();
      if (t >= bucketStart && t < bucketEnd) {
        status = entry.status;
      }
    }

    // If no entry in this bucket, carry forward from previous bucket
    if (status === null && i > 0) {
      status = buckets[i - 1].status;
    }

    buckets.push({
      status,
      startTime: new Date(bucketStart),
      endTime: new Date(bucketEnd),
    });
  }

  return buckets;
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
