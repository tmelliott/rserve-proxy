import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  children?: ReactNode;
}

export function EmptyState({ message, children }: EmptyStateProps) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-gray-500">{message}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
