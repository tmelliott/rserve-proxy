/** User account */
export interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
}

/** API token (as returned to the UI — never includes the raw token after creation) */
export interface ApiToken {
  id: string;
  name: string;
  /** Only present on creation response */
  token?: string;
  /** First 8 chars for display */
  tokenPrefix: string;
  userId: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

/** Login request */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Login response */
export interface LoginResponse {
  user: User;
}
