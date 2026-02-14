import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Play, Square, RotateCw, Plus } from "lucide-react";
import type { AppWithStatus } from "@rserve-proxy/shared";
import { api, ApiError } from "../../lib/api.js";
import { POLL_INTERVAL_MS } from "../../lib/constants.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { Button } from "../../components/ui/Button.js";
import { Spinner } from "../../components/ui/Spinner.js";

type ActionType = "start" | "stop" | "restart";

export function AppList() {
  const [apps, setApps] = useState<AppWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchApps = useCallback(async () => {
    try {
      const { apps } = await api.apps.list();
      setApps(apps);
      setError("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load apps",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
    const interval = setInterval(fetchApps, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchApps]);

  useEffect(() => {
    if (!banner) return;
    const timeout = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(timeout);
  }, [banner]);

  const handleAction = async (appId: string, action: ActionType) => {
    setActionLoading((prev) => ({ ...prev, [appId]: true }));
    try {
      await api.apps[action](appId);
      setBanner({
        type: "success",
        message: `App ${action} initiated`,
      });
      await fetchApps();
    } catch (err) {
      setBanner({
        type: "error",
        message:
          err instanceof ApiError ? err.message : `Failed to ${action} app`,
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [appId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Apps</h1>
        <Link to="/apps/new">
          <Button size="md">
            <Plus className="h-4 w-4" />
            New App
          </Button>
        </Link>
      </div>

      {banner && (
        <div
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            banner.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {banner.message}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {apps.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-sm text-gray-500">No apps yet.</p>
          <Link to="/apps/new" className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-500">
            Create your first app
          </Link>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Slug
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  R Version
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {apps.map((app) => (
                <tr key={app.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/apps/${app.id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      {app.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {app.slug}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {app.rVersion}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {(app.status === "stopped" || app.status === "error") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={actionLoading[app.id]}
                          onClick={() => handleAction(app.id, "start")}
                          title="Start"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {app.status === "running" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={actionLoading[app.id]}
                            onClick={() => handleAction(app.id, "restart")}
                            title="Restart"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={actionLoading[app.id]}
                            onClick={() => handleAction(app.id, "stop")}
                            title="Stop"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
