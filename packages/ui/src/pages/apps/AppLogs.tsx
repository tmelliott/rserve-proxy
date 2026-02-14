import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/Button.js";

const MAX_LINES = 5000;

export function AppLogs() {
  const { id } = useParams<{ id: string }>();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    const eventSource = new EventSource(`/api/apps/${id}/logs`);

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.addEventListener("log", (e) => {
      setLines((prev) => {
        const next = [...prev, e.data];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });

    eventSource.addEventListener("status", (e) => {
      setStatus(e.data);
    });

    return () => eventSource.close();
  }, [id]);

  useEffect(() => {
    if (follow) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, follow]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setFollow(atBottom);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/apps/${id}`}>
            <Button size="sm" variant="ghost">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Logs</h1>
          {status && (
            <span className="text-sm text-gray-500">({status})</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-300"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <button
            onClick={() => setFollow(!follow)}
            className={`text-xs ${follow ? "text-indigo-600" : "text-gray-400"}`}
          >
            Auto-scroll {follow ? "on" : "off"}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="mt-4 flex-1 overflow-y-auto rounded-lg bg-gray-900 p-4 font-mono text-sm text-green-400"
        style={{ minHeight: "300px", maxHeight: "calc(100vh - 220px)" }}
      >
        {lines.length === 0 && (
          <p className="text-gray-500">Waiting for log output...</p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
