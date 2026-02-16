import { Cpu, MemoryStick, Network, Container } from "lucide-react";
import type { AppMetricsSnapshot } from "@rserve-proxy/shared";

interface AppResourceCardsProps {
  latest: AppMetricsSnapshot | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function Card({ icon, label, value, sub }: CardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-gray-500">{sub}</p>}
    </div>
  );
}

export function AppResourceCards({ latest }: AppResourceCardsProps) {
  if (!latest) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card icon={<Cpu className="h-4 w-4" />} label="CPU" value="--" />
        <Card icon={<MemoryStick className="h-4 w-4" />} label="Memory" value="--" />
        <Card icon={<Network className="h-4 w-4" />} label="Network" value="--" />
        <Card icon={<Container className="h-4 w-4" />} label="Containers" value="--" />
      </div>
    );
  }

  const memPercent =
    latest.memoryLimitMB > 0
      ? ((latest.memoryMB / latest.memoryLimitMB) * 100).toFixed(0)
      : "0";

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card
        icon={<Cpu className="h-4 w-4" />}
        label="CPU"
        value={`${latest.cpuPercent.toFixed(1)}%`}
      />
      <Card
        icon={<MemoryStick className="h-4 w-4" />}
        label="Memory"
        value={`${latest.memoryMB.toFixed(0)} MB`}
        sub={`${memPercent}% of ${latest.memoryLimitMB.toFixed(0)} MB`}
      />
      <Card
        icon={<Network className="h-4 w-4" />}
        label="Network"
        value={`${formatBytes(latest.networkRxBytes)} in`}
        sub={`${formatBytes(latest.networkTxBytes)} out`}
      />
      <Card
        icon={<Container className="h-4 w-4" />}
        label="Containers"
        value={String(latest.containers)}
      />
    </div>
  );
}
