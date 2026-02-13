# Manager service Dockerfile
# Multi-stage build: install deps + build, then run on Node

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

# --- Production stage ---
FROM node:22-alpine
WORKDIR /app

# Copy built API
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/api/package.json packages/api/

# Copy built UI static files
COPY --from=builder /app/packages/ui/dist packages/ui/dist

# Copy shared dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/package.json packages/shared/

# Copy root package.json and install production deps only
COPY package.json ./
RUN npm install --omit=dev --workspaces

EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
