import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { requireAuth } from "../hooks/require-auth.js";
import {
  CreateAppBody,
  UpdateAppBody,
  AppIdParams,
} from "./apps.schemas.js";
import type { AppConfig } from "@rserve-proxy/shared";

/** Base directory for uploaded app code */
const UPLOAD_DIR =
  process.env.UPLOAD_DIR ||
  (process.env.NODE_ENV === "production" ? "/data/uploads" : "./data/uploads");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a DB row to an AppConfig */
function rowToAppConfig(row: typeof apps.$inferSelect): AppConfig {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    rVersion: row.rVersion,
    packages: row.packages ?? [],
    codeSource: row.codeSource,
    entryScript: row.entryScript,
    replicas: row.replicas,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Check if the current user can access the given app.
 * Admins can access any app; regular users can only access their own.
 */
function canAccess(
  session: { userId?: string; role?: string },
  appOwnerId: string,
): boolean {
  if (session.role === "admin") return true;
  return session.userId === appOwnerId;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const appRoutes: FastifyPluginAsync = async (app) => {
  // All app routes require authentication
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // POST /api/apps — Create a new app
  // -----------------------------------------------------------------------
  app.post<{ Body: CreateAppBody }>(
    "/",
    {
      schema: {
        body: CreateAppBody,
      },
    },
    async (request, reply) => {
      const {
        name,
        slug,
        rVersion = "4.4.1",
        packages = [],
        codeSource,
        entryScript = "run_rserve.R",
        replicas = 1,
      } = request.body;

      // Check slug uniqueness
      const existing = await db
        .select({ id: apps.id })
        .from(apps)
        .where(eq(apps.slug, slug))
        .limit(1);

      if (existing.length > 0) {
        return reply
          .status(409)
          .send({ error: `An app with slug "${slug}" already exists` });
      }

      const [row] = await db
        .insert(apps)
        .values({
          name,
          slug,
          rVersion,
          packages,
          codeSource,
          entryScript,
          replicas,
          ownerId: request.session.userId!,
        })
        .returning();

      return reply.status(201).send({ app: rowToAppConfig(row) });
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/apps — List apps
  // -----------------------------------------------------------------------
  app.get("/", async (request, reply) => {
    const isAdmin = request.session.role === "admin";

    const rows = isAdmin
      ? await db.select().from(apps).orderBy(apps.createdAt)
      : await db
          .select()
          .from(apps)
          .where(eq(apps.ownerId, request.session.userId!))
          .orderBy(apps.createdAt);

    // Enrich with live status from the health monitor
    const result = await Promise.all(
      rows.map(async (row) => {
        const config = rowToAppConfig(row);
        const snapshot = app.healthMonitor.getSnapshot(row.id);
        const status = snapshot?.status ?? (await app.spawner.getAppStatus(row.id));
        const containers =
          snapshot?.containers ?? (await app.spawner.getContainers(row.id));
        const wsPath = status === "running" ? `/${config.slug}/` : undefined;
        return { ...config, status, containers, wsPath };
      }),
    );

    return reply.send({ apps: result });
  });

  // -----------------------------------------------------------------------
  // GET /api/apps/:id — App detail
  // -----------------------------------------------------------------------
  app.get<{ Params: AppIdParams }>(
    "/:id",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const config = rowToAppConfig(row);
      const snapshot = app.healthMonitor.getSnapshot(id);
      const status = snapshot?.status ?? (await app.spawner.getAppStatus(id));
      const containers =
        snapshot?.containers ?? (await app.spawner.getContainers(id));
      const wsPath = status === "running" ? `/${config.slug}/` : undefined;

      return reply.send({ app: { ...config, status, containers, wsPath } });
    },
  );

  // -----------------------------------------------------------------------
  // PUT /api/apps/:id — Update app config
  // -----------------------------------------------------------------------
  app.put<{ Params: AppIdParams; Body: UpdateAppBody }>(
    "/:id",
    {
      schema: {
        params: AppIdParams,
        body: UpdateAppBody,
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Fetch existing
      const [existing] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, existing.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const updates: Partial<typeof apps.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (request.body.name !== undefined) updates.name = request.body.name;
      if (request.body.rVersion !== undefined)
        updates.rVersion = request.body.rVersion;
      if (request.body.packages !== undefined)
        updates.packages = request.body.packages;
      if (request.body.codeSource !== undefined)
        updates.codeSource = request.body.codeSource;
      if (request.body.entryScript !== undefined)
        updates.entryScript = request.body.entryScript;
      if (request.body.replicas !== undefined)
        updates.replicas = request.body.replicas;

      const [updated] = await db
        .update(apps)
        .set(updates)
        .where(eq(apps.id, id))
        .returning();

      return reply.send({ app: rowToAppConfig(updated) });
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /api/apps/:id — Delete app (stops containers, removes from DB)
  // -----------------------------------------------------------------------
  app.delete<{ Params: AppIdParams }>(
    "/:id",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [existing] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, existing.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // Stop containers + remove ALL Docker resources (containers + images)
      try {
        await app.spawner.stopApp(id);
        await app.spawner.cleanup(id);
        await app.spawner.removeImages(id);
      } catch {
        // Best effort — containers/images may not exist
      }

      // Remove uploaded code
      const uploadPath = join(UPLOAD_DIR, id);
      await rm(uploadPath, { recursive: true, force: true }).catch(() => {});

      // Untrack from health monitor
      app.healthMonitor.untrack(id);

      // Delete from DB
      await db.delete(apps).where(eq(apps.id, id));

      return reply.send({ ok: true });
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/apps/:id/start — Build image + start containers
  // -----------------------------------------------------------------------
  app.post<{ Params: AppIdParams }>(
    "/:id/start",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const config = rowToAppConfig(row);
      const codePath =
        config.codeSource.type === "upload"
          ? join(UPLOAD_DIR, id)
          : undefined;

      // Track in health monitor
      app.healthMonitor.track(id);

      try {
        if (codePath) {
          // Upload source: build image explicitly with codePath, then start
          const buildResult = await app.spawner.buildImage({
            appConfig: config,
            codePath,
          });
          if (!buildResult.success) {
            return reply.status(500).send({
              error: `Build failed: ${buildResult.error}`,
              buildLog: buildResult.buildLog,
            });
          }
          await app.spawner.startApp({
            appConfig: config,
            imageName: `${buildResult.imageName}:${buildResult.imageTag}`,
          });
        } else {
          // Git source: startApp will build + start automatically
          await app.spawner.startApp({ appConfig: config });
        }
        return reply.send({ ok: true, status: "starting" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/apps/:id/stop — Stop containers
  // -----------------------------------------------------------------------
  app.post<{ Params: AppIdParams }>(
    "/:id/stop",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        await app.spawner.stopApp(id);
        return reply.send({ ok: true, status: "stopped" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/apps/:id/restart — Restart containers
  // -----------------------------------------------------------------------
  app.post<{ Params: AppIdParams }>(
    "/:id/restart",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        await app.spawner.restartApp(id);
        return reply.send({ ok: true, status: "restarting" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/apps/:id/rebuild — Force rebuild + restart
  // -----------------------------------------------------------------------
  app.post<{ Params: AppIdParams }>(
    "/:id/rebuild",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      const config = rowToAppConfig(row);
      const codePath =
        config.codeSource.type === "upload"
          ? join(UPLOAD_DIR, id)
          : undefined;

      try {
        // Stop existing containers
        await app.spawner.stopApp(id).catch(() => {});

        // Rebuild image
        const result = await app.spawner.buildImage({
          appConfig: config,
          codePath,
        });

        if (!result.success) {
          return reply.status(500).send({
            error: `Build failed: ${result.error}`,
            buildLog: result.buildLog,
          });
        }

        // Start with new image
        await app.spawner.startApp({
          appConfig: config,
          imageName: `${result.imageName}:${result.imageTag}`,
        });

        return reply.send({
          ok: true,
          status: "starting",
          imageName: result.imageName,
          imageTag: result.imageTag,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/apps/:id/logs — Stream build logs via SSE
  // -----------------------------------------------------------------------
  app.get<{ Params: AppIdParams }>(
    "/:id/logs",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (event: string, data: string) => {
        reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
      };

      // Stream build logs
      await app.spawner.streamBuildLogs(id, (line) => {
        send("log", line);
      });

      // Also send current status
      const status = await app.spawner.getAppStatus(id);
      send("status", status);

      // Keep the connection open for a bit to allow new logs to arrive
      // The client can close when done
      const keepAlive = setInterval(() => {
        reply.raw.write(":keepalive\n\n");
      }, 15_000);

      request.raw.on("close", () => {
        clearInterval(keepAlive);
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/apps/:id/upload — Upload R code (zip/tar)
  // -----------------------------------------------------------------------
  app.post<{ Params: AppIdParams }>(
    "/:id/upload",
    {
      schema: { params: AppIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const [row] = await db
        .select()
        .from(apps)
        .where(eq(apps.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      if (row.codeSource.type !== "upload") {
        return reply.status(400).send({
          error:
            'This app uses git source. Change codeSource to "upload" first.',
        });
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const uploadPath = join(UPLOAD_DIR, id);

      // Clear previous upload and recreate dir
      await rm(uploadPath, { recursive: true, force: true }).catch(() => {});
      await mkdir(uploadPath, { recursive: true });

      const filePath = join(uploadPath, data.filename);
      await pipeline(data.file, createWriteStream(filePath));

      // If it's a zip or tar, extract it
      const ext = data.filename.toLowerCase();
      if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) {
        const { execFileSync } = await import("node:child_process");
        execFileSync("tar", ["-xzf", filePath, "-C", uploadPath]);
        await rm(filePath).catch(() => {}); // remove the archive
      } else if (ext.endsWith(".zip")) {
        const { execFileSync } = await import("node:child_process");
        execFileSync("unzip", ["-o", filePath, "-d", uploadPath]);
        await rm(filePath).catch(() => {}); // remove the archive
      }
      // Otherwise, the file is placed as-is

      return reply.send({
        ok: true,
        path: uploadPath,
        filename: data.filename,
      });
    },
  );
};
