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

### 1b. API Token Auth ✓

- [x] Implement `POST /api/auth/tokens` — generate token (nanoid), SHA-256 hash, store in DB, return raw token once
- [x] Implement `GET /api/auth/tokens` — list tokens for current user (prefix only)
- [x] Implement `DELETE /api/auth/tokens/:id` — revoke token (own tokens only)
- [x] Extend `requireAuth` to also accept `Authorization: Bearer <token>` header
- [x] Tokens check `expiresAt` and update `lastUsedAt` (fire-and-forget)
- [x] Tests: token CRUD, Bearer auth, expired/invalid token rejection (12 new tests)

### 1c. Role-Based Access (light) ✓

- [x] Admin role can manage all apps and users
- [x] User role can only manage their own apps and tokens
- [x] `requireAdmin` guard ready for admin-only routes
- [x] `requireAuth` applied to all app routes at plugin level
- [x] Tests: admin vs user role access, app route auth guards (5 new tests, 25 total)

**Test:** Login via `curl`, use the cookie to hit `/api/auth/me`, create a
token, use it in `Authorization: Bearer` header.

---

## Phase 2 — Spawner Core

**Goal:** The spawner can build a custom Rserve Docker image and start/stop a
container that Traefik auto-discovers.

### 2a. Base Image ✓

- [x] Script to build `rserve-base:X.Y.Z` from `images/rserve-base/Dockerfile`
- [x] Add `docker:build-base` npm script (accepts R version arg)
- [x] Verify a plain `rserve-base` container starts and Rserve listens on 6311

### 2b. Dynamic Image Build ✓

- [x] Implement `DockerSpawner.buildImage()`:
  - Generate a temp Dockerfile: `FROM rserve-base:{version}` → `pak::pak(packages)` → `COPY code /app`
  - For git source: clone repo into build context
  - For upload source: copy uploaded files into build context
  - Build via dockerode, stream logs
  - Tag as `rserve-app-{slug}:{hash}`
  - Apply `managed-by=rserve-proxy` label to image

### 2c. Container Lifecycle ✓

- [x] Implement `DockerSpawner.startApp()`:
  - Build image (if not provided)
  - Create container with Traefik labels:
    - `traefik.enable=true`
    - `traefik.http.routers.{slug}.rule=PathPrefix('/{slug}')`
    - `traefik.http.services.{slug}.loadbalancer.server.port=6311`
  - Connect to compose network
  - Start container
  - Apply `managed-by` + `app-id` labels
- [x] Implement `DockerSpawner.stopApp()` — stop + remove containers for app
- [x] Implement `DockerSpawner.restartApp()` — stop then start
- [x] Implement `DockerSpawner.getAppStatus()` — query Docker for container state
- [x] Implement `DockerSpawner.getContainers()` — return container info list
- [x] Implement `DockerSpawner.cleanup()` — remove stopped containers + dangling images for app
- [x] Implement `DockerSpawner.streamBuildLogs()` — stream build output via callback
- [x] Tests: spawner unit tests with mocked dockerode (21 tests, 46 total)

### 2d. Health Checking ✓

- [x] Add Docker HEALTHCHECK to generated Dockerfiles (TCP check on Rserve port)
- [x] Add `HealthMonitor` class with periodic polling loop
- [x] Auto-discover untracked containers from Docker
- [x] Cache per-app health snapshots in memory
- [x] `onStatusChange` callback for status transitions
- [x] Expose health info via `getSnapshot()` / `getAllSnapshots()`
- [x] Tests: health monitor with mocked spawner (8 tests, 54 total)

**Test:** Manually call spawner methods from a test script → confirm container
appears in `docker ps`, Traefik routes to it, and it responds to Rserve requests.

---

## Phase 3 — App Management API ✓

**Goal:** Full CRUD for apps via REST API, backed by Postgres + Spawner.

- [x] `POST /api/apps` — validate input, insert into DB, return app config
- [x] `GET /api/apps` — list all apps (admin) or own apps (user), include live status from spawner
- [x] `GET /api/apps/:id` — app detail with spawner status + container info
- [x] `PUT /api/apps/:id` — update app config (name, packages, R version, replicas, etc.)
- [x] `DELETE /api/apps/:id` — stop containers, remove images, delete from DB
- [x] `POST /api/apps/:id/start` — trigger image build + container start
- [x] `POST /api/apps/:id/stop` — stop containers
- [x] `POST /api/apps/:id/restart` — restart containers
- [x] `POST /api/apps/:id/rebuild` — force rebuild image + restart
- [x] `GET /api/apps/:id/logs` — stream build/runtime logs (SSE)

### Input Validation ✓

- [x] Add Typebox schemas for all request bodies (`apps.schemas.ts`)
- [x] Validate slug uniqueness, R version format, package names, git URLs
- [x] UUID validation on `:id` params

### File Upload ✓

- [x] Install `@fastify/multipart` (50 MB limit)
- [x] `POST /api/apps/:id/upload` — accept zip/tar/R files, store in `app_uploads` volume
- [x] Auto-extract `.tar.gz`, `.tgz`, `.zip` archives
- [x] Wire upload path into spawner's build context

### Wiring ✓

- [x] Decorate Fastify with `spawner` and `healthMonitor` instances
- [x] Start health monitor on `onReady`, stop on `onClose`
- [x] `buildApp()` accepts optional `spawner`/`healthMonitor` overrides for testing

### Tests ✓

- [x] 35 app route tests: CRUD, lifecycle, auth guards, validation, upload (89 total)

**Test:** Create an app via API, start it, confirm it's routable via Traefik,
stop it, delete it.

---

## Phase 4 — Web UI

**Goal:** A functional admin dashboard for managing apps without touching the
API directly.

### 4a. Foundation ✓

- [x] Set up Tailwind CSS (already in devDeps, wire up config)
- [x] Create a layout shell: sidebar nav, top bar with user info + logout
- [x] Auth context provider — check `/api/auth/me` on load, redirect to login if unauthenticated
- [x] Login page — form, error handling, redirect to dashboard on success

### 4b. Dashboard ✓

- [x] App list page — table/card view of all apps with status badges (running/stopped/error)
- [x] Status auto-refresh (polling or SSE)
- [x] Quick actions: start/stop/restart buttons per app

### 4c. App Management ✓

- [x] "New App" form — name, slug, R version, packages (tag input), code source (git URL or upload), entry script
- [x] App detail page — config summary, status, container list, action buttons
- [x] Edit app page — update config fields
- [x] Log viewer — scrollable, auto-follow build/runtime logs
- [x] Delete confirmation dialog

### 4d. Settings & Tokens ✓

- [x] API tokens page — list tokens, create new, copy-once, revoke
- [x] User profile / password change

**Test:** Walk through the full UI flow: login → create app → start → view logs
→ verify it's live → stop → delete.

---

## Phase 5 — Integration & Polish

**Goal:** The system is robust enough for a single-user/small-team deployment.

- [x] Rserve connectivity — WebSocket mode: Rserv.conf injected into generated Dockerfiles (`http.port 8081`), Traefik labels route to WS port, API returns `wsPath` when running, UI shows connection URL + JS snippet
- [x] Request validation on all API routes — Typebox schemas for auth routes (login, password, tokens), global error handler normalises validation errors
- [x] Proper error handling — global `setErrorHandler` with structured responses: validation → 400 + details, rate limit → 429, unexpected → 500 with context (dev) / generic (prod)
- [x] Graceful shutdown — SIGTERM/SIGINT handlers, `app.close()` drains connections + stops health monitor, 10s hard timeout
- [x] Rate limiting on auth routes — `@fastify/rate-limit` (global: false), login capped at 10 req/min per IP
- [x] CORS lock-down in production — `secure: true` cookie in prod, CORS origin from env or reflect-request
- [x] Add `docker:cleanup` npm script — `bun run docker:cleanup` calls `DockerSpawner.cleanupAll()`
- [x] Structured logging — pino with request IDs (`x-request-id` or UUID), credential redaction in production
- [x] E2E smoke test script — `scripts/smoke-test.sh`: health → login → me → create app → list → detail → update → token CRUD → bearer auth → delete → logout

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

## Phase 7 — Observability Dashboard

**Goal:** A real-time monitoring dashboard with uptime history, resource usage,
and request metrics — both system-wide and per-app.

### 7a. Metrics Collection Backend ✓

> Collect and store time-series data from Docker and Traefik.

- [x] **Status history store** — ring-buffer recording per-app status every 60s
      (appId, status, timestamp). Retains last 24h in memory (1440 entries).
- [x] **Container stats collector** — `MetricsCollector` service polls
      `dockerode.container.stats()` every 60s for each running container. Extracts:
  - CPU usage % (from `cpu_stats` delta calculation)
  - Memory usage (RSS) and limit
  - Network RX/TX bytes (delta per interval)
- [x] **Cluster-level aggregation** — sum per-app metrics into system totals:
      total CPU %, total memory used / available, total network I/O
- [ ] **Request counting** — scrape Traefik's built-in Prometheus metrics
      endpoint (`/metrics` on the Traefik entrypoint) for per-service
      `traefik_service_requests_total`, compute requests/min per app (deferred to 7d)
- [x] **New API endpoints:**
  - `GET /api/metrics/system` — cluster-wide resource usage over time
  - `GET /api/metrics/apps/:id` — per-app resource usage over time
  - `GET /api/status/history` — all apps' status timeline
  - `GET /api/apps/:id/status/history` — single app's status timeline
  - Query params: `?period=1h|6h|24h|7d` to control time range
- [x] **Tests** — 10 collector unit tests + 12 route tests (111 total)

### 7b. System Status Dashboard (UI) ✓

> Overview page showing at-a-glance health of the entire platform.

- [x] **Uptime grid** — each app as a row, columns = 1-minute buckets,
      cells colored green (running), red (error/down), yellow (starting/stopping),
      gray (stopped). Show last 60 minutes by default, expandable to 24h.
- [x] **Cluster resource summary cards** — top of dashboard:
  - Total CPU usage (% of host)
  - Total memory usage (used / available)
  - Total network throughput (in/out)
  - Total active containers
  - Total requests/min across all apps
- [x] **Cluster resource charts** — time-series line charts (last 1h/6h/24h):
  - CPU % over time
  - Memory % over time
  - Network I/O over time
- [x] **Auto-refresh** — poll metrics endpoints every 60s, status every 15s

### 7c. Per-App Monitoring (UI) ✓

> Extend the existing app detail page with resource and uptime data.

- [x] **Uptime timeline** — horizontal bar on app detail page showing
      minute-by-minute status for last 60 min (same color scheme as grid).
      Hover for timestamp + status. Expandable to 24h.
- [x] **Resource charts** — per-app time-series charts on detail page:
  - CPU usage % over time
  - Memory usage (MB) over time with limit line
  - Network RX/TX bytes/sec over time
  - Requests/min over time
- [x] **Current stats summary** — live-updating cards showing current
      CPU %, memory MB / limit, network rates, uptime duration
- [x] **Chart library** — recharts@3.7.0 added to UI package

### 7d. Traefik Metrics Integration ✓

> Wire up Traefik to expose per-service metrics the API can scrape.

- [x] Enable Traefik Prometheus metrics provider in compose config
      (`--metrics.prometheus=true`, expose on internal port 8082)
- [x] API scrapes Traefik `/metrics` endpoint on each collection cycle
- [x] Parse `traefik_service_requests_total` counter by service name,
      compute per-app request rate (requests/min delta)
- [x] UI shows requests/min in resource cards and time-series charts
      (conditionally — only when Traefik data is available)
- [x] Tests — 8 scraper + 3 collector integration tests (122 total)

---

## Stretch Goals (Future)

- [x] Auto-inject `run.Rserve()` — user scripts just define `oc.init`, platform handles WebSocket startup (port 8081, no QAP)
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

## Known Issues

> Investigate these once all phases are complete.

1. **Start rebuilds image unnecessarily** — Stopping a running app and then
   clicking "Start" triggers a full image rebuild. The `/start` endpoint
   always calls `buildImage` → `startApp` instead of reusing the existing
   image when config hasn't changed. Should only rebuild on explicit
   "Rebuild" action.

2. **Containers list slow to update** — After stopping an app, the container
   list on the detail page takes a while to reflect the change. Likely the
   health monitor polling interval is too long or the UI isn't re-fetching
   quickly enough after a stop action completes.

3. **Upload UX needs improvement** — The "upload" code source type doesn't
   show the uploaded file/archive contents after upload. Should: display the
   extracted file tree in the UI so the user can verify the upload succeeded,
   and allow selecting/checking one of the `.R` files as the entry script
   (instead of only auto-detecting when there's exactly one). The edit page
   also doesn't surface the upload filename or let users re-upload.

---

## Working On

> Update this section as you work through the phases.

**Current phase:** 6 — Production Hardening (remaining items)
**Completed:** Phase 0 ✓, Phase 1 ✓, Phase 2 ✓, Phase 3 ✓, Phase 4 ✓, Phase 5 ✓, Phase 7 ✓
