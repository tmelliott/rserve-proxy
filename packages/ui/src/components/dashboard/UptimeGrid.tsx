import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { AppStatusHistory, MetricsPeriod } from "@rserve-proxy/shared";
import {
  bucketize,
  formatBucketTime,
  formatUptimeTooltip,
  uptimeColor,
  type BucketInfo,
} from "./uptime-utils.js";

interface UptimeGridProps {
  apps: AppStatusHistory[];
  period: MetricsPeriod;
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
                    uptimeColor(bucket.uptimePercent),
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
            {formatUptimeTooltip(tooltip.bucket)}
          </div>
        </div>
      )}
    </div>
  );
}
