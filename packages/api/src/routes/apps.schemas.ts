/**
 * Typebox schemas for App CRUD routes.
 *
 * These produce both runtime JSON Schema validators (used by Fastify)
 * and static TypeScript types via `Static<>`.
 */

import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Reusable fragments
// ---------------------------------------------------------------------------

const SlugPattern = "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$";


const CodeSourceGit = Type.Object({
  type: Type.Literal("git"),
  repoUrl: Type.String({ format: "uri" }),
  branch: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

const CodeSourceUpload = Type.Object({
  type: Type.Literal("upload"),
});

const CodeSource = Type.Union([CodeSourceGit, CodeSourceUpload]);

// ---------------------------------------------------------------------------
// POST /api/apps — Create App
// ---------------------------------------------------------------------------

export const CreateAppBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  slug: Type.String({ minLength: 3, maxLength: 64, pattern: SlugPattern }),
  rVersion: Type.Optional(
    Type.String({ minLength: 1, default: "latest" }),
  ),
  packages: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { default: [] })),
  codeSource: CodeSource,
  entryScript: Type.Optional(
    Type.String({ minLength: 1, maxLength: 256, default: "run_rserve.R" }),
  ),
  replicas: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 10, default: 1 }),
  ),
});

export type CreateAppBody = Static<typeof CreateAppBody>;

// ---------------------------------------------------------------------------
// PUT /api/apps/:id — Update App
// ---------------------------------------------------------------------------

export const UpdateAppBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  rVersion: Type.Optional(Type.String({ minLength: 1 })),
  packages: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  codeSource: Type.Optional(CodeSource),
  entryScript: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  replicas: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

export type UpdateAppBody = Static<typeof UpdateAppBody>;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const AppIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export type AppIdParams = Static<typeof AppIdParams>;
