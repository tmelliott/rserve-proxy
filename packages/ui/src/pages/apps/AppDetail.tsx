import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Play,
  Square,
  RotateCw,
  Hammer,
  Pencil,
  Trash2,
  ScrollText,
  Upload,
  Copy,
  Check,
} from "lucide-react";
import type { AppWithStatus } from "@rserve-proxy/shared";
import { api, ApiError } from "../../lib/api.js";
import { POLL_INTERVAL_MS } from "../../lib/constants.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { Button } from "../../components/ui/Button.js";
import { Spinner } from "../../components/ui/Spinner.js";
import { Modal } from "../../components/ui/Modal.js";

export function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<AppWithStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchApp = useCallback(async () => {
    if (!id) return;
    try {
      const { app } = await api.apps.get(id);
      setApp(app);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load app");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchApp();
    const interval = setInterval(fetchApp, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchApp]);

  useEffect(() => {
    if (!banner) return;
    const timeout = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(timeout);
  }, [banner]);

  const handleAction = async (action: "start" | "stop" | "restart" | "rebuild") => {
    if (!id) return;
    setActionLoading(true);
    try {
      await api.apps[action](id);
      setBanner({ type: "success", message: `App ${action} initiated` });
      await fetchApp();
    } catch (err) {
      setBanner({
        type: "error",
        message: err instanceof ApiError ? err.message : `Failed to ${action}`,
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleteLoading(true);
    try {
      await api.apps.delete(id);
      navigate("/");
    } catch (err) {
      setBanner({
        type: "error",
        message: err instanceof ApiError ? err.message : "Failed to delete app",
      });
      setShowDelete(false);
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-red-600">{error || "App not found"}</p>
        <Link to="/" className="mt-2 inline-block text-sm text-indigo-600">
          Back to apps
        </Link>
      </div>
    );
  }

  const isStopped = app.status === "stopped" || app.status === "error" || !app.status;
  const isRunning = app.status === "running";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-900">{app.name}</h1>
          <StatusBadge status={app.status} />
        </div>
        <div className="flex items-center gap-2">
          {isStopped && (
            <Button
              size="sm"
              loading={actionLoading}
              onClick={() => handleAction("start")}
            >
              <Play className="h-3.5 w-3.5" />
              Start
            </Button>
          )}
          {isRunning && (
            <>
              <Button
                size="sm"
                variant="ghost"
                loading={actionLoading}
                onClick={() => handleAction("restart")}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Restart
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={actionLoading}
                onClick={() => handleAction("stop")}
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={actionLoading}
            onClick={() => handleAction("rebuild")}
          >
            <Hammer className="h-3.5 w-3.5" />
            Rebuild
          </Button>
          <Link to={`/apps/${app.id}/logs`}>
            <Button size="sm" variant="ghost">
              <ScrollText className="h-3.5 w-3.5" />
              Logs
            </Button>
          </Link>
          <Link to={`/apps/${app.id}/edit`}>
            <Button size="sm" variant="ghost">
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </Link>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
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

      {/* Config Summary */}
      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Configuration</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <Row label="Slug" value={app.slug} />
          <Row label="R Version" value={app.rVersion} />
          <Row
            label="Packages"
            value={
              app.packages.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {app.packages.map((pkg) => (
                    <span
                      key={pkg}
                      className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
                    >
                      {pkg}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-gray-400">None</span>
              )
            }
          />
          <Row
            label="Code Source"
            value={
              app.codeSource.type === "git"
                ? `Git: ${app.codeSource.repoUrl}${app.codeSource.branch ? ` (${app.codeSource.branch})` : ""}`
                : "Upload"
            }
          />
          {app.codeSource.type === "git" && (
            <Row label="Entry Script" value={app.entryScript} />
          )}
          <Row label="Replicas" value={String(app.replicas)} />
        </dl>
      </div>

      {/* Connection info — shown when app is running */}
      {app.wsPath && (
        <ConnectionInfo wsPath={app.wsPath} />
      )}

      {/* Code (upload-type apps only) */}
      {app.codeSource.type === "upload" && (
        <CodeSection appId={app.id} entryScript={app.entryScript} setBanner={setBanner} />
      )}

      {/* Containers */}
      {app.containers.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-700">Containers</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Container ID
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Health
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Port
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {app.containers.map((c) => (
                <tr key={c.containerId}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">
                    {c.containerId.slice(0, 12)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {c.status}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {c.healthStatus ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {c.port}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Error info */}
      {app.error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <h2 className="text-sm font-medium text-red-800">Error</h2>
          <p className="mt-1 text-sm text-red-700">{app.error}</p>
        </div>
      )}

      {/* Delete modal */}
      <Modal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        title={`Delete ${app.name}?`}
      >
        <p className="text-sm text-gray-600">
          This will stop all containers, remove Docker images, and delete the
          app configuration. This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteLoading}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex px-4 py-3">
      <dt className="w-32 shrink-0 text-sm font-medium text-gray-500">
        {label}
      </dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function ConnectionInfo({ wsPath }: { wsPath: string }) {
  const [copied, setCopied] = useState(false);
  const wsUrl = `${window.location.origin}${wsPath}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(wsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const snippet = `import Rserve from "rserve";\n\nconst client = Rserve.create({\n  host: "${wsUrl}",\n});`;

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-green-200 bg-green-50">
      <div className="border-b border-green-200 bg-green-100 px-4 py-3">
        <h2 className="text-sm font-medium text-green-800">
          Connection — WebSocket
        </h2>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-white px-3 py-1.5 font-mono text-sm text-gray-800 ring-1 ring-green-200">
            {wsUrl}
          </code>
          <button
            onClick={handleCopy}
            className="rounded p-1.5 text-green-700 hover:bg-green-100"
            title="Copy URL"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-green-800">
            JavaScript usage
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-gray-700 ring-1 ring-green-200">
            {snippet}
          </pre>
        </details>
      </div>
    </div>
  );
}

function CodeSection({
  appId,
  entryScript,
  setBanner,
}: {
  appId: string;
  entryScript: string;
  setBanner: (b: { type: "success" | "error"; message: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [lastFile, setLastFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSaveCode = async () => {
    if (!code.trim()) return;
    setSaving(true);
    try {
      const file = new File([code], entryScript, {
        type: "text/plain",
      });
      await api.apps.upload(appId, file);
      setLastFile(entryScript);
      setBanner({ type: "success", message: `Saved ${entryScript}` });
    } catch (err) {
      setBanner({
        type: "error",
        message:
          err instanceof ApiError ? err.message : "Failed to save code",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadMessage("");
    try {
      await api.apps.upload(appId, file);
      setUploadMessage(`Uploaded: ${file.name}`);
      setLastFile(file.name);
      setBanner({ type: "success", message: `Uploaded ${file.name}` });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Upload failed";
      setUploadMessage(`Error: ${msg}`);
      setBanner({ type: "error", message: msg });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-700">Code</h2>
      </div>
      <div className="space-y-4 p-4">
        {lastFile && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <span>Current file: <span className="font-medium">{lastFile}</span></span>
          </div>
        )}
        {/* Manual code entry */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Write R code ({entryScript})
          </label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={10}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder={`# Enter your R code here\nlibrary(Rserve)\nRserve(args="--no-save")`}
          />
          <div className="mt-2">
            <Button
              size="sm"
              onClick={handleSaveCode}
              loading={saving}
              disabled={!code.trim()}
            >
              Save Code
            </Button>
          </div>
        </div>

        {/* File upload */}
        <div className="border-t border-gray-200 pt-4">
          <label className="block text-sm font-medium text-gray-700">
            Or upload files
          </label>
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-gray-400">
            <Upload className="h-4 w-4" />
            {uploading
              ? "Uploading..."
              : "Choose .zip, .tar.gz, .tgz, or .R file"}
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.gz,.tgz,.R"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
          </label>
          {uploadMessage && (
            <p className={`mt-1 text-xs ${uploadMessage.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
              {uploadMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
