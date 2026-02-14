import type { AppStatus } from "@rserve-proxy/shared";

export const POLL_INTERVAL_MS = 5_000;

export const STATUS_CONFIG: Record<
  AppStatus,
  { label: string; className: string }
> = {
  running: {
    label: "Running",
    className: "bg-green-100 text-green-700",
  },
  building: {
    label: "Building",
    className: "bg-amber-100 text-amber-700",
  },
  starting: {
    label: "Starting",
    className: "bg-amber-100 text-amber-700",
  },
  stopping: {
    label: "Stopping",
    className: "bg-gray-100 text-gray-600",
  },
  stopped: {
    label: "Stopped",
    className: "bg-gray-100 text-gray-600",
  },
  error: {
    label: "Error",
    className: "bg-red-100 text-red-700",
  },
};
