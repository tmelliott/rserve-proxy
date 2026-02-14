import type { AppStatus } from "@rserve-proxy/shared";
import { STATUS_CONFIG } from "../../lib/constants.js";

export function StatusBadge({ status }: { status: AppStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        Unknown
      </span>
    );
  }
  const { label, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
