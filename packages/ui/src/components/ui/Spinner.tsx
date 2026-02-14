import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "h-6 w-6 animate-spin rounded-full border-3 border-gray-200 border-t-indigo-600",
        className,
      )}
    />
  );
}
