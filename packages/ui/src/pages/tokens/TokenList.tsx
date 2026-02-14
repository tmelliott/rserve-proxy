import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Copy, Trash2 } from "lucide-react";
import type { ApiToken } from "@rserve-proxy/shared";
import { api, ApiError } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { Spinner } from "../../components/ui/Spinner.js";
import { Modal } from "../../components/ui/Modal.js";

interface CreateTokenForm {
  name: string;
  expiresInDays: string;
}

export function TokenList() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<CreateTokenForm>({
    defaultValues: { name: "", expiresInDays: "" },
  });

  const fetchTokens = async () => {
    try {
      const { tokens } = await api.auth.listTokens();
      setTokens(tokens);
      setError("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load tokens",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  const onCreate = async (data: CreateTokenForm) => {
    setError("");
    setNewToken(null);
    try {
      const body: { name: string; expiresInDays?: number } = {
        name: data.name,
      };
      if (data.expiresInDays) {
        body.expiresInDays = Number(data.expiresInDays);
      }
      const { token } = await api.auth.createToken(body);
      setNewToken(token.token ?? null);
      reset();
      await fetchTokens();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create token",
      );
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.auth.revokeToken(revokeTarget.id);
      setRevokeTarget(null);
      await fetchTokens();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to revoke token",
      );
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <h1 className="text-lg font-semibold text-gray-900">API Tokens</h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Create token form */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-700">Create new token</h2>
        <form
          onSubmit={handleSubmit(onCreate)}
          className="mt-3 flex items-end gap-3"
        >
          <Input
            id="token-name"
            label="Name"
            className="flex-1"
            {...register("name", { required: true })}
            placeholder="e.g. CI pipeline"
          />
          <div>
            <label
              htmlFor="token-expiry"
              className="block text-sm font-medium text-gray-700"
            >
              Expires
            </label>
            <select
              id="token-expiry"
              className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              {...register("expiresInDays")}
            >
              <option value="">Never</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <Button type="submit" loading={isSubmitting}>
            Create
          </Button>
        </form>
      </div>

      {/* New token display */}
      {newToken && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            Copy this token now. You will not be able to see it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-gray-900 select-all">
              {newToken}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleCopy(newToken)}
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">No API tokens yet.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Prefix
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Last Used
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Expires
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tokens.map((token) => (
                <tr key={token.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {token.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-500">
                    {token.tokenPrefix}...
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(token.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {token.expiresAt ? formatDate(token.expiresAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRevokeTarget(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Revoke confirmation */}
      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke token?"
      >
        <p className="text-sm text-gray-600">
          Are you sure you want to revoke{" "}
          <span className="font-medium">{revokeTarget?.name}</span>? Any
          integrations using this token will stop working.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={revoking} onClick={handleRevoke}>
            Revoke
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
