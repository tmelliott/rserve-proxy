# Manager service Dockerfile
# Multi-stage build: Bun for deps + build, Node for production runtime

# --- Build stage ---
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/ui/package.json packages/ui/

# Install all dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/ui/ packages/ui/

# Build shared, then API and UI
RUN cd packages/shared && bun run build
RUN cd packages/api && bun run build
RUN cd packages/ui && bun run build

# --- Production deps (Bun resolves workspace:* protocol) ---
FROM oven/bun:1 AS prod-deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/ui/package.json packages/ui/

RUN bun install --frozen-lockfile --production --ignore-scripts

# --- Production runtime ---
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app

# Copy production node_modules (Bun hoists everything to root)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built artifacts + package.json for each workspace package
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/api/drizzle packages/api/drizzle
COPY --from=builder /app/packages/ui/dist packages/ui/dist

EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
