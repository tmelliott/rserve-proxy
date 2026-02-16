import clsx from "clsx";
import type { MetricsPeriod } from "@rserve-proxy/shared";

const PERIODS: { value: MetricsPeriod; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

interface PeriodSelectorProps {
  value: MetricsPeriod;
  onChange: (period: MetricsPeriod) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-200">
      {PERIODS.map(({ value: p, label }) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={clsx(
            "px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md",
            p === value
              ? "bg-indigo-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
