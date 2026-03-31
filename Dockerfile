# ==============================================================================
# Loomflo — Multi-stage Docker Build
# ==============================================================================
# Builds all monorepo packages (core, cli, dashboard, sdk) and produces a lean
# production image that runs the Loomflo daemon with the dashboard embedded.
#
# Usage:
#   docker build -t loomflo .
#   docker run -e ANTHROPIC_API_KEY=sk-... -p 3000:3000 -v ./project:/workspace loomflo
# ==============================================================================

# ---------------------------------------------------------------------------
# Stage 1: base — shared Node.js + pnpm layer
# ---------------------------------------------------------------------------
FROM node:20-slim AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 2: deps — install all dependencies (dev + prod)
# ---------------------------------------------------------------------------
FROM base AS deps

# Copy workspace definition and all package.json files first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: build — compile TypeScript and bundle all packages
# ---------------------------------------------------------------------------
FROM deps AS build

# Copy source files (node_modules already present from deps stage)
COPY tsconfig.base.json turbo.json ./
COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/core/src/ packages/core/src/
COPY packages/cli/tsconfig.json packages/cli/tsconfig.json
COPY packages/cli/src/ packages/cli/src/
COPY packages/sdk/tsconfig.json packages/sdk/tsconfig.json
COPY packages/sdk/src/ packages/sdk/src/
COPY packages/dashboard/tsconfig.json packages/dashboard/tsconfig.json
COPY packages/dashboard/vite.config.ts packages/dashboard/vite.config.ts
COPY packages/dashboard/tailwind.config.ts packages/dashboard/tailwind.config.ts
COPY packages/dashboard/index.html packages/dashboard/index.html
COPY packages/dashboard/src/ packages/dashboard/src/

# Build everything via Turborepo
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 4: prod-deps — production-only dependencies
# ---------------------------------------------------------------------------
FROM base AS prod-deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 5: runner — lean production image
# ---------------------------------------------------------------------------
FROM node:20-slim AS runner

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Security: run as non-root user
RUN groupadd --gid 1001 loomflo && \
    useradd --uid 1001 --gid loomflo --create-home loomflo

WORKDIR /app

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=prod-deps /app/packages/sdk/node_modules ./packages/sdk/node_modules

# Copy built artifacts
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist

# Copy package.json files (needed for module resolution)
COPY package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY pnpm-workspace.yaml ./

# Create directories for daemon state and workspace
RUN mkdir -p /home/loomflo/.loomflo /workspace && \
    chown -R loomflo:loomflo /app /home/loomflo/.loomflo /workspace

USER loomflo

# Daemon listens on port 3000 by default
EXPOSE 3000

# Bind to 0.0.0.0 inside container (default is 127.0.0.1)
ENV LOOMFLO_HOST=0.0.0.0
ENV LOOMFLO_PORT=3000
ENV LOOMFLO_PROJECT_PATH=/workspace
ENV LOOMFLO_DASHBOARD_PATH=/app/packages/dashboard/dist
ENV NODE_ENV=production

# Run the daemon directly via the core entry point
CMD ["node", "packages/core/dist/daemon-entry.js"]
