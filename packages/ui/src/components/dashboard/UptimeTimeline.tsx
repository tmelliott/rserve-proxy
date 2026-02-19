import { useMemo, useState } from "react";
import clsx from "clsx";
import type { MetricsPeriod, StatusHistoryEntry } from "@rserve-proxy/shared";
import {
  bucketize,
  formatBucketTime,
  formatUptimeTooltip,
  uptimeColor,
  type BucketInfo,
} from "./uptime-utils.js";

interface UptimeTimelineProps {
  entries: StatusHistoryEntry[];
  period: MetricsPeriod;
}

export function UptimeTimeline({ entries, period }: UptimeTimelineProps) {
  const [tooltip, setTooltip] = useState<{
    bucket: BucketInfo;
    x: number;
    y: number;
  } | null>(null);

  const buckets = useMemo(
    () => bucketize(entries, period),
    [entries, period],
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-medium text-gray-700">Uptime</h4>
      <div className="flex gap-px">
        {buckets.map((bucket, i) => (
          <div
            key={i}
            className={clsx(
              "h-6 flex-1 rounded-sm transition-opacity hover:opacity-80",
              uptimeColor(bucket.uptimePercent),
            )}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltip({
                bucket,
                x: rect.left + rect.width / 2,
                y: rect.top,
              });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>{formatBucketTime(buckets[0]?.startTime ?? new Date(), period)}</span>
        <span>now</span>
      </div>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div>
            {formatBucketTime(tooltip.bucket.startTime, period)}
            {" — "}
            {formatUptimeTooltip(tooltip.bucket)}
          </div>
        </div>
      )}
    </div>
  );
}
