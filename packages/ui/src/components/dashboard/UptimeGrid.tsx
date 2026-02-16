import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type {
  AppStatusHistory,
  AppStatus,
  MetricsPeriod,
} from "@rserve-proxy/shared";
import { STATUS_COLORS } from "../../lib/constants.js";

interface UptimeGridProps {
  apps: AppStatusHistory[];
  period: MetricsPeriod;
}

/** Number of columns (time buckets) to show per period */
const BUCKET_COUNTS: Record<MetricsPeriod, number> = {
  "1h": 60,
  "6h": 60,
  "24h": 60,
  "7d": 84, // 2h buckets
};

/** Bucket duration in ms per period */
const BUCKET_MS: Record<MetricsPeriod, number> = {
  "1h": 60_000,           // 1 min
  "6h": 6 * 60_000,       // 6 min
  "24h": 24 * 60_000,     // 24 min
  "7d": 2 * 60 * 60_000,  // 2 hours
};

interface BucketInfo {
  status: AppStatus | null;
  startTime: Date;
  endTime: Date;
}

function bucketize(
  entries: AppStatusHistory["entries"],
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

function formatBucketTime(date: Date, period: MetricsPeriod): string {
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

export function UptimeGrid({ apps, period }: UptimeGridProps) {
  const [tooltip, setTooltip] = useState<{
    appName: string;
    bucket: BucketInfo;
    x: number;
    y: number;
  } | null>(null);

  const appBuckets = useMemo(
    () =>
      apps.map((app) => ({
        ...app,
        buckets: bucketize(app.entries, period),
      })),
    [apps, period],
  );

  if (apps.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No apps to display
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-700">App Uptime</h3>
      <div className="space-y-2">
        {appBuckets.map(({ appId, appName, buckets }) => (
          <div key={appId} className="flex items-center gap-3">
            <Link
              to={`/apps/${appId}`}
              className="w-32 shrink-0 truncate text-sm font-medium text-indigo-600 hover:text-indigo-800"
              title={appName}
            >
              {appName}
            </Link>
            <div className="flex flex-1 gap-px">
              {buckets.map((bucket, i) => (
                <div
                  key={i}
                  className={clsx(
                    "h-5 flex-1 rounded-sm transition-opacity hover:opacity-80",
                    bucket.status
                      ? STATUS_COLORS[bucket.status]
                      : "bg-gray-100",
                  )}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({
                      appName,
                      bucket,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="font-medium">{tooltip.appName}</div>
          <div>
            {formatBucketTime(tooltip.bucket.startTime, period)}
            {" — "}
            {tooltip.bucket.status ?? "no data"}
          </div>
        </div>
      )}
    </div>
  );
}
