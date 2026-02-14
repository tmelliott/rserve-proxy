/**
 * Typebox schemas for Auth routes.
 *
 * These produce both runtime JSON Schema validators (used by Fastify)
 * and static TypeScript types via `Static<>`.
 */

import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

export const LoginBody = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 128 }),
  password: Type.String({ minLength: 1, maxLength: 256 }),
});

export type LoginBody = Static<typeof LoginBody>;

// ---------------------------------------------------------------------------
// PUT /api/auth/password
// ---------------------------------------------------------------------------

export const ChangePasswordBody = Type.Object({
  currentPassword: Type.String({ minLength: 1, maxLength: 256 }),
  newPassword: Type.String({ minLength: 8, maxLength: 256 }),
});

export type ChangePasswordBody = Static<typeof ChangePasswordBody>;

// ---------------------------------------------------------------------------
// POST /api/auth/tokens
// ---------------------------------------------------------------------------

export const CreateTokenBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  expiresInDays: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 365 }),
  ),
});

export type CreateTokenBody = Static<typeof CreateTokenBody>;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const TokenIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export type TokenIdParams = Static<typeof TokenIdParams>;
