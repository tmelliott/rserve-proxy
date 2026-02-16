/**
 * Typebox schemas for metrics API routes.
 */

import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const MetricsQuery = Type.Object({
  period: Type.Optional(
    Type.Union([
      Type.Literal("1h"),
      Type.Literal("6h"),
      Type.Literal("24h"),
      Type.Literal("7d"),
    ], { default: "1h" }),
  ),
});

export type MetricsQuery = Static<typeof MetricsQuery>;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const AppIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

export type AppIdParams = Static<typeof AppIdParams>;
