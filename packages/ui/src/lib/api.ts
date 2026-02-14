import type {
  User,
  AppConfig,
  AppWithStatus,
  ApiToken,
  LoginRequest,
} from "@rserve-proxy/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) {
    headers["Content-Type"] ??= "application/json";
  }
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.json();
}

export const api = {
  auth: {
    login: (body: LoginRequest) =>
      request<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    logout: () =>
      request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    me: () => request<{ user: User }>("/api/auth/me"),
    listTokens: () => request<{ tokens: ApiToken[] }>("/api/auth/tokens"),
    createToken: (body: { name: string; expiresInDays?: number }) =>
      request<{ token: ApiToken }>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    revokeToken: (id: string) =>
      request<{ ok: true }>(`/api/auth/tokens/${id}`, { method: "DELETE" }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      request<{ ok: true }>("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
  },
  apps: {
    list: () => request<{ apps: AppWithStatus[] }>("/api/apps"),
    get: (id: string) => request<{ app: AppWithStatus }>(`/api/apps/${id}`),
    create: (
      body: Omit<AppConfig, "id" | "ownerId" | "createdAt" | "updatedAt">,
    ) =>
      request<{ app: AppConfig }>("/api/apps", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Partial<AppConfig>) =>
      request<{ app: AppConfig }>(`/api/apps/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ ok: true }>(`/api/apps/${id}`, { method: "DELETE" }),
    start: (id: string) =>
      request<{ ok: true; status: string }>(`/api/apps/${id}/start`, {
        method: "POST",
      }),
    stop: (id: string) =>
      request<{ ok: true; status: string }>(`/api/apps/${id}/stop`, {
        method: "POST",
      }),
    restart: (id: string) =>
      request<{ ok: true; status: string }>(`/api/apps/${id}/restart`, {
        method: "POST",
      }),
    rebuild: (id: string) =>
      request<{ ok: true; status: string }>(`/api/apps/${id}/rebuild`, {
        method: "POST",
      }),
    upload: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`/api/apps/${id}/upload`, {
        method: "POST",
        body: form,
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(res.status, body.error || res.statusText);
        }
        return res.json() as Promise<{
          ok: true;
          path: string;
          filename: string;
        }>;
      });
    },
  },
};
