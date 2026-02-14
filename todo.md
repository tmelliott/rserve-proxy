# Implementation Strategy

> Phased plan for `rserve-proxy`. Each phase builds on the previous and ends
> with a working, testable slice of the system. Phases are ordered by
> dependency — later phases assume earlier ones are complete.
>
> **Testing policy:** Every phase must include vitest unit/integration tests
> for new functionality. Tests use `app.inject()` with mocked DB so they
> run without Postgres. Run `bun run test` to verify nothing is broken
> before committing.

---

## Phase 0 — Dev Stack Boots

**Goal:** `bun run docker:dev` starts Traefik + Postgres + Manager and you can
hit `http://localhost:8880/api/health` and get a 200.

- [x] Verify `docker compose` brings up Traefik, Postgres, Manager without errors
- [x] Run Drizzle migrations on startup (or add a `db:push` script)
- [x] Wire up the health route to return `{ status: "ok", db: true }` (ping Postgres)
- [x] Add a `seed` script that creates an initial admin user (username + hashed password)
- [x] Confirm Traefik dashboard is accessible at `http://localhost:8881`

**Test:** `curl http://localhost:8880/api/health` → `200 OK`

---

## Phase 1 — Authentication

**Goal:** Admin can log in via the API, get a session cookie, and make
authenticated requests. API tokens can be created for programmatic access.

### 1a. Session Auth ✓

- [x] Install + configure `@fastify/session` with in-memory cookie store
- [x] Install `argon2` for password hashing
- [x] Implement `POST /api/auth/login` — validate credentials, create session, set cookie
- [x] Implement `POST /api/auth/logout` — destroy session, clear cookie
- [x] Implement `GET /api/auth/me` — return current user from session
- [x] Create `requireAuth` middleware/hook that rejects unauthenticated requests
- [x] Extract `buildApp()` into `src/app.ts` for testability
- [x] Add vitest + auth route tests (8 tests)

### 1b. API Token Auth

- [ ] Implement `POST /api/auth/tokens` — generate token, hash it, store in DB, return raw token once
- [ ] Implement `GET /api/auth/tokens` — list tokens for current user (prefix only)
- [ ] Implement `DELETE /api/auth/tokens/:id` — revoke token
- [ ] Extend `requireAuth` to also accept `Authorization: Bearer <token>` header
- [ ] Tokens should check `expiresAt` and update `lastUsedAt`
- [ ] Tests: token CRUD, Bearer auth, expired token rejection

### 1c. Role-Based Access (light)

- [ ] Admin role can manage all apps and users
- [ ] User role can only manage their own apps and tokens
- [ ] Add `requireAdmin` guard for admin-only routes (e.g., user management)
- [ ] Tests: admin vs user role access, requireAdmin guard

**Test:** Login via `curl`, use the cookie to hit `/api/auth/me`, create a
token, use it in `Authorization: Bearer` header.

---

## Phase 2 — Spawner Core

**Goal:** The spawner can build a custom Rserve Docker image and start/stop a
container that Traefik auto-discovers.

### 2a. Base Image

- [ ] Script to build `rserve-base:X.Y.Z` from `images/rserve-base/Dockerfile`
- [ ] Add `docker:build-base` npm script (accepts R version arg)
- [ ] Verify a plain `rserve-base` container starts and Rserve listens on 6311

### 2b. Dynamic Image Build

- [ ] Implement `DockerSpawner.buildImage()`:
  - Generate a temp Dockerfile: `FROM rserve-base:{version}` → `pak::pak(packages)` → `COPY code /app`
  - For git source: clone repo into build context
  - For upload source: copy uploaded files into build context
  - Build via dockerode, stream logs
  - Tag as `rserve-app-{slug}:{hash}`
  - Apply `managed-by=rserve-proxy` label to image

### 2c. Container Lifecycle

- [ ] Implement `DockerSpawner.startApp()`:
  - Build image (if not provided)
  - Create container with Traefik labels:
    - `traefik.enable=true`
    - `traefik.http.routers.{slug}.rule=PathPrefix('/{slug}')`
    - `traefik.http.services.{slug}.loadbalancer.server.port=6311`
  - Connect to compose network
  - Start container
  - Apply `managed-by` + `app-id` labels
- [ ] Implement `DockerSpawner.stopApp()` — stop + remove containers for app
- [ ] Implement `DockerSpawner.restartApp()` — stop then start
- [ ] Implement `DockerSpawner.getAppStatus()` — query Docker for container state
- [ ] Implement `DockerSpawner.getContainers()` — return container info list
- [ ] Implement `DockerSpawner.cleanup()` — remove stopped containers + dangling images for app
- [ ] Implement `DockerSpawner.streamBuildLogs()` — stream build output via callback
- [ ] Tests: spawner unit tests with mocked dockerode

### 2d. Health Checking

- [ ] Add a periodic health check loop in the spawner (or manager) that pings each running container
- [ ] Update container health status in memory (spawner state)
- [ ] Expose health info via `getAppStatus()`

**Test:** Manually call spawner methods from a test script → confirm container
appears in `docker ps`, Traefik routes to it, and it responds to Rserve requests.

---

## Phase 3 — App Management API

**Goal:** Full CRUD for apps via REST API, backed by Postgres + Spawner.

- [ ] `POST /api/apps` — validate input, insert into DB, return app config
- [ ] `GET /api/apps` — list all apps (admin) or own apps (user), include live status from spawner
- [ ] `GET /api/apps/:id` — app detail with spawner status + container info
- [ ] `PUT /api/apps/:id` — update app config (name, packages, R version, replicas, etc.)
- [ ] `DELETE /api/apps/:id` — stop containers, remove images, delete from DB
- [ ] `POST /api/apps/:id/start` — trigger image build + container start
- [ ] `POST /api/apps/:id/stop` — stop containers
- [ ] `POST /api/apps/:id/restart` — restart containers
- [ ] `POST /api/apps/:id/rebuild` — force rebuild image + restart
- [ ] `GET /api/apps/:id/logs` — stream build/runtime logs (SSE or WebSocket)

### Input Validation

- [ ] Add Typebox or Zod schemas for all request bodies
- [ ] Validate slug uniqueness, R version format, package names, git URLs

### File Upload

- [ ] Install `@fastify/multipart`
- [ ] `POST /api/apps/:id/upload` — accept zip/tar of R code, store in `app_uploads` volume
- [ ] Wire upload path into spawner's build context
- [ ] Tests: app CRUD routes, input validation, auth guards on all endpoints

**Test:** Create an app via API, start it, confirm it's routable via Traefik,
stop it, delete it.

---

## Phase 4 — Web UI

**Goal:** A functional admin dashboard for managing apps without touching the
API directly.

### 4a. Foundation

- [ ] Set up Tailwind CSS (already in devDeps, wire up config)
- [ ] Create a layout shell: sidebar nav, top bar with user info + logout
- [ ] Auth context provider — check `/api/auth/me` on load, redirect to login if unauthenticated
- [ ] Login page — form, error handling, redirect to dashboard on success

### 4b. Dashboard

- [ ] App list page — table/card view of all apps with status badges (running/stopped/error)
- [ ] Status auto-refresh (polling or SSE)
- [ ] Quick actions: start/stop/restart buttons per app

### 4c. App Management

- [ ] "New App" form — name, slug, R version, packages (tag input), code source (git URL or upload), entry script
- [ ] App detail page — config summary, status, container list, action buttons
- [ ] Edit app page — update config fields
- [ ] Log viewer — scrollable, auto-follow build/runtime logs
- [ ] Delete confirmation dialog

### 4d. Settings & Tokens

- [ ] API tokens page — list tokens, create new, copy-once, revoke
- [ ] User profile / password change (stretch)

**Test:** Walk through the full UI flow: login → create app → start → view logs
→ verify it's live → stop → delete.

---

## Phase 5 — Integration & Polish

**Goal:** The system is robust enough for a single-user/small-team deployment.

- [ ] Request validation on all API routes (return 400 with clear messages)
- [ ] Proper error handling — spawner errors surface as 500s with context
- [ ] Graceful shutdown — stop health check loop, drain HTTP connections
- [ ] Rate limiting on auth routes (`@fastify/rate-limit`)
- [ ] CORS lock-down in production (only allow same origin)
- [ ] Add `docker:cleanup` npm script that calls `DockerSpawner.cleanupAll()`
- [ ] Structured logging (pino, already in Fastify)
- [ ] E2E smoke test script: create app, start, curl Rserve, stop, delete

---

## Phase 6 — Production Hardening

**Goal:** Ready for real-world deployment on a VPS.

- [ ] Enable Traefik HTTPS + Let's Encrypt (uncomment compose config, add env vars)
- [ ] Secret management — `DATABASE_URL`, session secret, etc. via `.env` or Docker secrets
- [ ] Postgres backup strategy (pg_dump cron or volume snapshot)
- [ ] Resource limits on spawned containers (CPU, memory)
- [ ] Container restart policies for spawned Rserve instances
- [ ] Log rotation for spawned containers
- [ ] Monitoring: expose Prometheus metrics from Fastify + Traefik
- [ ] Alerting hooks (webhook on app crash / unhealthy)

---

## Stretch Goals (Future)

- [ ] Multi-user workspace isolation
- [ ] Dependency scanning — auto-detect `library()` / `::` calls in uploaded R code
- [ ] Git webhook integration — auto-rebuild on push
- [ ] Replica scaling UI — adjust replica count, rolling updates
- [ ] Kubernetes spawner — extract spawner, implement K8s backend
- [ ] Docker Swarm support — use Swarm services instead of standalone containers
- [ ] App environment variables — let users set custom env vars per app
- [ ] Custom domain per app (Traefik Host rule)
- [ ] Audit log — who did what, when

---

## Working On

> Update this section as you work through the phases.

**Current phase:** 1b — API Token Auth
**Completed:** Phase 0 ✓, Phase 1a — Session Auth ✓
